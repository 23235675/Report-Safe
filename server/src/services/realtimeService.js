'use strict';

const { Server } = require('socket.io');
const { SOCKET_EVENTS, GLOBAL_ROOM } = require('../lib/socketEvents');
const { isWithinRadius } = require('../lib/geo');
const { getStats } = require('./reportStore');
const { logger } = require('../lib/logger');
const { corsOptions } = require('../lib/httpSecurity');

/**
 * Per-process socket→location map.
 *
 * Single-instance: the canonical source of truth.
 * Multi-instance (Redis adapter): each process tracks ONLY its own connected
 * sockets.  broadcastDisasterAlert uses io.fetchSockets() to reach sockets on
 * remote instances (works because the Redis adapter syncs socket membership),
 * so this map is still correct — it is populated by the `register` event from
 * the local socket, not by Redis.  Remote sockets that registered on a different
 * instance are reached via the Socket.IO adapter routing layer.
 */
const socketLocations = new Map();

let statsTimer = null;
let _io = null;

/**
 * Initialise Socket.IO, optionally attaching the Redis adapter for multi-instance.
 *
 * @param {import('http').Server} server
 * @param {{ pub: import('redis').RedisClientType, sub: import('redis').RedisClientType } | null} redisPair
 * @returns {import('socket.io').Server}
 */
function initSocketIO(server, redisPair = null) {
  const io = new Server(server, {
    cors: corsOptions(),
  });

  if (redisPair) {
    // Attach the Redis pub/sub adapter — enables cross-instance broadcasts and
    // makes io.fetchSockets() span all instances.
    const { createAdapter } = require('@socket.io/redis-adapter');
    io.adapter(createAdapter(redisPair.pub, redisPair.sub));
    logger.info('socket_io_redis_adapter_attached');
  }

  _io = io;

  io.on('connection', (socket) => {
    socket.join(GLOBAL_ROOM);

    socket.on(SOCKET_EVENTS.REGISTER, (payload) => {
      try {
        const lat = Number(payload?.lat);
        const lng = Number(payload?.lng);
        // Device role (mobile | web). Only MOBILE devices receive personal,
        // location-targeted disaster alerts (disaster mode + push) — web is a
        // data-collection console and never enters disaster mode. Defaults to
        // 'web' so an unidentified client is never treated as an affected person.
        const userType = payload?.userType === 'mobile' ? 'mobile' : 'web';
        // Identity (optional): lets the server target this socket for a
        // loved-one alert when one of its CONFIRMED links is in a disaster zone.
        const userId = typeof payload?.userId === 'string' && payload.userId ? payload.userId : null;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          socketLocations.set(socket.id, { lat, lng, userType, userId });
        }
      } catch (err) {
        logger.error('register_location_failed', { error: err.message });
      }
    });

    socket.on('disconnect', () => {
      socketLocations.delete(socket.id);
    });
  });

  const interval = Number(process.env.WS_STATS_INTERVAL_MS) || 10000;
  // Leader-gated (C4): the periodic broadcast fires once per tick cluster-wide,
  // not N× (once per instance). Event-driven broadcastStats() calls (on a new
  // report) stay per-instance — they're idempotent and must feel instant.
  const { runIfLeader } = require('../lib/leaderLock');
  statsTimer = setInterval(
    () => runIfLeader('stats', Math.ceil(interval * 1.1), () => broadcastStats(io)).catch(() => {}),
    interval
  );
  if (statsTimer.unref) statsTimer.unref();

  return io;
}

/**
 * Emit disaster_alert to every MOBILE socket whose registered location is
 * inside the disaster radius.
 *
 * Device role split (mobile = emergency, web = data collection): the personal
 * disaster alert that triggers disaster mode + a push notification goes ONLY to
 * mobile devices in the affected zone. Web clients are skipped even when located
 * inside the radius — they never enter disaster mode and are never counted as an
 * affected person. (Rationale: a person carrying both a phone and a laptop must
 * not be alerted twice or generate a duplicate report — the phone is the source
 * of truth for "am I affected".)
 *
 * Multi-instance: uses io.fetchSockets() (spans all instances via the Redis
 * adapter) + the per-process socketLocations map on each instance.  Each
 * instance emits only to the sockets it owns — the adapter handles routing.
 *
 * Single-instance: falls back to iterating socketLocations directly.
 */
async function broadcastDisasterAlert(io, disaster) {
  try {
    if (!io || !disaster) return;
    const center = { lat: disaster.lat, lng: disaster.lng };

    // io.fetchSockets() is async and spans all instances with the Redis adapter.
    const sockets = await io.fetchSockets();
    for (const socket of sockets) {
      const loc = socketLocations.get(socket.id);
      if (!loc || loc.userType !== 'mobile') continue; // mobile-only personal alert
      if (isWithinRadius(loc, center, disaster.radius_km)) {
        io.to(socket.id).emit(SOCKET_EVENTS.DISASTER_ALERT, disaster);
      }
    }
  } catch (err) {
    logger.error('broadcast_disaster_alert_failed', { error: err.message });
  }
}

/**
 * Emit loved_one_alert to the OPEN mobile apps of a set of users — the confirmed
 * relatives of someone inside a disaster zone. Mirrors the closed-app push path
 * (pushService.sendLovedOneAlert); together they cover both states.
 *
 * Targeted strictly by identity: only sockets that registered with one of the
 * `partnerUserIds` receive it, and only mobile ones. The recipients are NOT in
 * the zone, so this surfaces their loved one's status WITHOUT entering disaster
 * mode (the payload is a loved_one_alert, not a disaster_alert).
 *
 * @param {import('socket.io').Server} io
 * @param {string[]} partnerUserIds user ids of the relatives to notify
 * @param {{ disaster: object, affectedName: string, affectedUserId: string }} payload
 */
async function broadcastLovedOneAlert(io, partnerUserIds, payload) {
  try {
    if (!io || !partnerUserIds || partnerUserIds.length === 0) return;
    const targets = new Set(partnerUserIds);
    const sockets = await io.fetchSockets();
    for (const socket of sockets) {
      const loc = socketLocations.get(socket.id);
      if (!loc || loc.userType !== 'mobile' || !loc.userId) continue;
      if (targets.has(loc.userId)) {
        io.to(socket.id).emit(SOCKET_EVENTS.LOVED_ONE_ALERT, payload);
      }
    }
  } catch (err) {
    logger.error('broadcast_loved_one_alert_failed', { error: err.message });
  }
}

/**
 * CFR: emit incident_alert to the OPEN mobile apps of a set of matched
 * responders. The incidentEngine already did the radius + skill + privacy
 * matching and resolved the responder user ids, so this targets strictly by
 * identity (mirrors broadcastLovedOneAlert) — no radius logic here.
 *
 * NON-GATING: incident_alert never enters disaster mode (only the victim does);
 * the recipient is a volunteer, not the affected person.
 *
 * @param {import('socket.io').Server} io
 * @param {string[]} responderUserIds matched responder user ids
 * @param {object} incident
 */
async function broadcastResponderAlert(io, responderUserIds, incident) {
  try {
    if (!io || !responderUserIds || responderUserIds.length === 0) return;
    const targets = new Set(responderUserIds);
    const sockets = await io.fetchSockets();
    for (const socket of sockets) {
      const loc = socketLocations.get(socket.id);
      if (!loc || loc.userType !== 'mobile' || !loc.userId) continue;
      if (targets.has(loc.userId)) {
        io.to(socket.id).emit(SOCKET_EVENTS.INCIDENT_ALERT, incident);
      }
    }
  } catch (err) {
    logger.error('broadcast_responder_alert_failed', { error: err.message });
  }
}

/**
 * CFR: notify a set of users (co-responders + dispatcher) that one responder's
 * status/position changed for an incident. Targeted by user id.
 * @param {import('socket.io').Server} io
 * @param {string[]} userIds
 * @param {object} payload { incidentId, response }
 */
async function broadcastIncidentUpdate(io, userIds, payload) {
  try {
    if (!io || !userIds || userIds.length === 0) return;
    const targets = new Set(userIds);
    const sockets = await io.fetchSockets();
    for (const socket of sockets) {
      const loc = socketLocations.get(socket.id);
      if (!loc || !loc.userId) continue;
      if (targets.has(loc.userId)) {
        io.to(socket.id).emit(SOCKET_EVENTS.INCIDENT_UPDATE, payload);
      }
    }
  } catch (err) {
    logger.error('broadcast_incident_update_failed', { error: err.message });
  }
}

/**
 * CFR: notify all clients an incident was resolved/stood down so responder
 * screens can close. Broadcast to the global room (cheap; the id is harmless and
 * only matters to clients currently viewing that incident).
 */
function broadcastIncidentResolved(io, incidentId) {
  try {
    if (!io || !incidentId) return;
    io.to(GLOBAL_ROOM).emit(SOCKET_EVENTS.INCIDENT_RESOLVED, { id: incidentId });
  } catch (err) {
    logger.error('broadcast_incident_resolved_failed', { error: err.message });
  }
}

/**
 * Emit fresh aggregate stats to all connected clients.
 */
async function broadcastStats(io) {
  try {
    if (!io) return;
    // Official affected counts NEVER include web (proxy) reporters (B2 / A6).
    const stats = await getStats({ excludeWeb: true });
    io.to(GLOBAL_ROOM).emit(SOCKET_EVENTS.STATS_UPDATE, stats);
  } catch (err) {
    logger.error('broadcast_stats_failed', { error: err.message });
  }
}

/**
 * Notify all clients that a disaster was ended (B20). Clients clear it from
 * their active list / map; the mobile gate self-heals on its next poll too.
 */
function broadcastDisasterDeactivated(io, disasterId) {
  try {
    if (!io || !disasterId) return;
    io.to(GLOBAL_ROOM).emit(SOCKET_EVENTS.DISASTER_DEACTIVATED, { id: disasterId });
  } catch (err) {
    logger.error('broadcast_disaster_deactivated_failed', { error: err.message });
  }
}

/**
 * Notify all clients that one or more reports were escalated to potentially_missing.
 */
function broadcastMissingAlert(io, ids) {
  try {
    if (!io || !ids || ids.length === 0) return;
    io.to(GLOBAL_ROOM).emit(SOCKET_EVENTS.MISSING_ALERT, { ids });
  } catch (err) {
    logger.error('broadcast_missing_alert_failed', { error: err.message });
  }
}

function stopStatsTimer() {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
}

module.exports = {
  initSocketIO,
  broadcastDisasterAlert,
  broadcastDisasterDeactivated,
  broadcastLovedOneAlert,
  broadcastResponderAlert,
  broadcastIncidentUpdate,
  broadcastIncidentResolved,
  broadcastStats,
  broadcastMissingAlert,
  stopStatsTimer,
  socketLocations,
};
