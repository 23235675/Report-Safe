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
 * sockets.  The hub emitters use io.fetchSockets() to reach sockets on remote
 * instances (works because the Redis adapter syncs socket membership), so this
 * map is still correct — it is populated by the `register` event from the
 * local socket, not by Redis.  Remote sockets that registered on a different
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
  // Leader-gated: the periodic broadcast fires once per tick cluster-wide,
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

/* ── The hub: the ONE broadcast implementation ──────────────────────────────
 * Every targeted emit goes through these three. Multi-instance:
 * io.fetchSockets() spans all instances via the Redis adapter; each instance
 * matches against its own socketLocations and the adapter routes the emit.
 */

/** Emit to every socket in the global room. */
function emitGlobal(io, event, payload) {
  if (!io) return;
  io.to(GLOBAL_ROOM).emit(event, payload);
}

/** Emit to every registered socket whose location entry matches `match(loc)`. */
async function emitWhere(io, event, payload, match) {
  if (!io) return;
  const sockets = await io.fetchSockets();
  for (const s of sockets) {
    const loc = socketLocations.get(s.id);
    if (loc && match(loc)) io.to(s.id).emit(event, payload);
  }
}

/**
 * Emit to the sockets of a set of users, targeted strictly by identity.
 * mobileOnly (default true) restricts delivery to mobile devices.
 */
async function emitToUsers(io, userIds, event, payload, { mobileOnly = true } = {}) {
  if (!userIds || userIds.length === 0) return;
  const targets = new Set(userIds);
  return emitWhere(io, event, payload, (loc) =>
    (!mobileOnly || loc.userType === 'mobile') && loc.userId != null && targets.has(loc.userId));
}

/**
 * Emit to every socket registered inside a radius around a centre point.
 * mobileOnly (default true) restricts delivery to mobile devices.
 */
async function emitInRadius(io, center, radiusKm, event, payload, { mobileOnly = true } = {}) {
  return emitWhere(io, event, payload, (loc) =>
    (!mobileOnly || loc.userType === 'mobile') && isWithinRadius(loc, center, radiusKm));
}

/* ── Named broadcasts (thin wrappers over the hub) ─────────────────────── */

/**
 * Emit disaster_alert to every MOBILE socket whose registered location is
 * inside the disaster radius. Web clients are skipped even when located inside
 * the radius — they never enter disaster mode and are never counted as an
 * affected person (a person carrying both a phone and a laptop must not be
 * alerted twice or generate a duplicate report — the phone is the source of
 * truth for "am I affected").
 */
async function broadcastDisasterAlert(io, disaster) {
  try {
    if (!io || !disaster) return;
    await emitInRadius(io, { lat: disaster.lat, lng: disaster.lng }, disaster.radius_km,
      SOCKET_EVENTS.DISASTER_ALERT, disaster);
  } catch (err) {
    logger.error('broadcast_disaster_alert_failed', { error: err.message });
  }
}

/**
 * Emit loved_one_alert to the OPEN mobile apps of a set of users — the confirmed
 * relatives of someone inside a disaster zone. Mirrors the closed-app push path
 * (pushService.sendLovedOneAlert); together they cover both states. The
 * recipients are NOT in the zone, so this surfaces their loved one's status
 * WITHOUT entering disaster mode.
 *
 * @param {import('socket.io').Server} io
 * @param {string[]} partnerUserIds user ids of the relatives to notify
 * @param {{ disaster: object, affectedName: string, affectedUserId: string }} payload
 */
async function broadcastLovedOneAlert(io, partnerUserIds, payload) {
  try {
    await emitToUsers(io, partnerUserIds, SOCKET_EVENTS.LOVED_ONE_ALERT, payload);
  } catch (err) {
    logger.error('broadcast_loved_one_alert_failed', { error: err.message });
  }
}

/**
 * CFR: emit incident_alert to the OPEN mobile apps of matched responders. The
 * incidentEngine already did the radius + skill + privacy matching, so this
 * targets strictly by identity. NON-GATING: incident_alert never enters
 * disaster mode — the recipient is a volunteer, not the affected person.
 */
async function broadcastResponderAlert(io, responderUserIds, incident) {
  try {
    await emitToUsers(io, responderUserIds, SOCKET_EVENTS.INCIDENT_ALERT, incident);
  } catch (err) {
    logger.error('broadcast_responder_alert_failed', { error: err.message });
  }
}

/**
 * CFR: notify a set of users (co-responders + dispatcher) that one responder's
 * status/position changed for an incident. Targeted by user id; NOT
 * mobile-only — a dispatcher console may be registered from the web.
 * @param {import('socket.io').Server} io
 * @param {string[]} userIds
 * @param {object} payload { incidentId, response }
 */
async function broadcastIncidentUpdate(io, userIds, payload) {
  try {
    await emitToUsers(io, userIds, SOCKET_EVENTS.INCIDENT_UPDATE, payload, { mobileOnly: false });
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
    if (!incidentId) return;
    emitGlobal(io, SOCKET_EVENTS.INCIDENT_RESOLVED, { id: incidentId });
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
    // Official affected counts NEVER include web (proxy) reporters.
    const stats = await getStats({ excludeWeb: true });
    emitGlobal(io, SOCKET_EVENTS.STATS_UPDATE, stats);
  } catch (err) {
    logger.error('broadcast_stats_failed', { error: err.message });
  }
}

/**
 * Notify all clients that a disaster was ended. Clients clear it from their
 * active list / map; the mobile gate self-heals on its next poll too.
 */
function broadcastDisasterDeactivated(io, disasterId) {
  try {
    if (!disasterId) return;
    emitGlobal(io, SOCKET_EVENTS.DISASTER_DEACTIVATED, { id: disasterId });
  } catch (err) {
    logger.error('broadcast_disaster_deactivated_failed', { error: err.message });
  }
}

/**
 * Notify all clients that one or more reports were escalated to potentially_missing.
 */
function broadcastMissingAlert(io, ids) {
  try {
    if (!ids || ids.length === 0) return;
    emitGlobal(io, SOCKET_EVENTS.MISSING_ALERT, { ids });
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
  emitGlobal,
  emitToUsers,
  emitInRadius,
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
