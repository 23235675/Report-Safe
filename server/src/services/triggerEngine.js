'use strict';

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { findWithinRadius, GEO_SCAN_CAP } = require('../lib/geo');
const { mapId } = require('../lib/mongoMap');
const { logger } = require('../lib/logger');
const realtimeService = require('./realtimeService');
const pushService = require('../lib/pushService');

/**
 * Disaster trigger engine.
 *
 * Polls mock "early warning" feeds on an interval and activates a disaster
 * whenever a signal crosses threshold (magnitude >= 6.0 OR severity >= 3).
 * On activation it persists the disaster and broadcasts a targeted alert.
 */

const MAGNITUDE_THRESHOLD = 6.0;
const SEVERITY_THRESHOLD = 3;
/** Two active disasters within this distance + same type are considered duplicates. */
const DUPLICATE_RADIUS_KM = 30;

/**
 * Hong Kong Observatory (HKO) warning alignment.
 *
 * The engine's internal `severity` is a 0–5 scale; this maps it to the official
 * HK public-warning name so disasters carry locally-correct semantics instead of
 * an ad-hoc number. Wildfire/brush-fire are intentionally absent (not a primary
 * HK hazard).
 *   typhoon  → Tropical Cyclone Warning Signals (T1/T3/T8/T9/T10)
 *   rainstorm/flood → Rainstorm Warning System (Amber/Red/Black)
 *   landslide/landslip → Landslip Warning
 */
const HKO_TC_SIGNALS = Object.freeze({
  1: 'Standby Signal No.1 (T1)',
  2: 'Strong Wind Signal No.3 (T3)',
  3: 'Gale/Storm Signal No.8 (T8)',
  4: 'Increasing Gale/Storm Signal No.9 (T9)',
  5: 'Hurricane Signal No.10 (T10)',
});
const HKO_RAINSTORM = Object.freeze({
  1: 'Amber Rainstorm Warning',
  2: 'Amber Rainstorm Warning',
  3: 'Red Rainstorm Warning',
  4: 'Black Rainstorm Warning',
  5: 'Black Rainstorm Warning',
});

/**
 * Map a disaster type + 0–5 severity to the official HKO signal name.
 * @returns {string|null} the HK warning name, or null for non-HK-standard types
 */
function hkoSignal(type, severity) {
  const s = Math.max(1, Math.min(5, Math.round(Number(severity) || 1)));
  if (type === 'typhoon') return HKO_TC_SIGNALS[s];
  if (type === 'rainstorm' || type === 'flood') return HKO_RAINSTORM[s];
  if (type === 'landslide' || type === 'landslip') return `Landslip Warning (level ${s})`;
  return null;
}

/** Rotating cursor so each poll returns a different mock signal. */
let feedCursor = 0;
/** Handle for the polling interval. */
let pollTimer = null;

/**
 * Early-warning feed signals. The project relies fully on the database;
 * disasters enter via the seed or POST /api/disasters/trigger. For demos,
 * ENABLE_MOCK_FEEDS=true turns on a small rotating set of Hong Kong
 * (HKO-style) signals. A real integration would fetch HKO warnings here
 * (https://data.weather.gov.hk).
 * @returns {Array<object>}
 */
function getMockDisasterFeeds() {
  if (process.env.ENABLE_MOCK_FEEDS !== 'true') return [];
  return [
    { type: 'typhoon',   magnitude: null, severity: 4, lat: 22.302, lng: 114.177, radius_km: 60, description: 'Demo: Typhoon — HKO Gale Signal No. 8 (T8).' },
    { type: 'flood',     magnitude: null, severity: 3, lat: 22.336, lng: 114.193, radius_km: 15, description: 'Demo: Black Rainstorm Warning — Kowloon flooding.' },
    { type: 'landslide', magnitude: null, severity: 2, lat: 22.271, lng: 114.150, radius_km: 5,  description: 'Demo: Landslip Warning — Mid-Levels.' },
  ];
}

/**
 * Whether a signal is severe enough to trigger a disaster.
 * @param {object} signal
 * @returns {boolean}
 */
function shouldTrigger(signal) {
  const mag = typeof signal.magnitude === 'number' ? signal.magnitude : -Infinity;
  const sev = typeof signal.severity === 'number' ? signal.severity : -Infinity;
  return mag >= MAGNITUDE_THRESHOLD || sev >= SEVERITY_THRESHOLD;
}

/**
 * Find an existing active disaster of the same type within DUPLICATE_RADIUS_KM.
 * @param {object} signal
 * @returns {Promise<object | undefined>}
 */
async function findDuplicateActive(signal) {
  const rows = await findWithinRadius('disasters', {
    lat: signal.lat, lng: signal.lng, radiusKm: DUPLICATE_RADIUS_KM,
    filter: { active: true, type: signal.type }, cap: null, map: mapId,
  });
  return rows[0];
}

/**
 * Find registered device push handles whose last known location is inside the
 * disaster radius.
 * @param {object} disaster
 * @returns {Promise<Array<{token:string, platform:string}>>}
 */
async function findDevicesInRadius(disaster) {
  const rows = await findWithinRadius('device_push_tokens', {
    lat: disaster.lat, lng: disaster.lng, radiusKm: disaster.radius_km,
    project: { _id: 0, token: 1, platform: 1, lat: 1, lng: 1 },
    sort: { lat: 1 }, cap: GEO_SCAN_CAP,
  });
  return rows.map((d) => ({ token: d.token, platform: d.platform }));
}

/**
 * Find REGISTERED users inside the disaster radius — the affected people whose
 * confirmed loved ones should be alerted. Sources both live device locations and
 * any reports filed from inside the zone, so it catches app-open users and
 * reporters alike. One row per distinct user, with the display name used in the
 * relative's notification.
 * @param {object} disaster
 * @returns {Promise<Array<{user_id:string, name:string}>>}
 */
async function findAffectedUsersInRadius(disaster) {
  const geoOpts = {
    lat: disaster.lat, lng: disaster.lng, radiusKm: disaster.radius_km,
    filter: { user_id: { $ne: null } },
    project: { user_id: 1, lat: 1, lng: 1 },
    sort: { lat: 1 }, cap: GEO_SCAN_CAP,
  };
  // Union of user_ids from in-zone device locations and in-zone reports.
  const [devs, reps] = await Promise.all([
    findWithinRadius('device_push_tokens', geoOpts),
    findWithinRadius('reports', geoOpts),
  ]);

  const affectedIds = new Set();
  for (const d of [...devs, ...reps]) {
    if (d.user_id) affectedIds.add(d.user_id);
  }
  if (affectedIds.size === 0) return [];

  // JOIN users — only ids that resolve to a real user are returned.
  const users = await collection('users')
    .find({ _id: { $in: [...affectedIds] } })
    .project({ _id: 1, name: 1 })
    .toArray();
  return users.map((u) => ({
    user_id: u._id,
    name: (u.name && u.name.trim()) ? u.name : 'Your contact',
  }));
}

/**
 * For a set of affected users, resolve their CONFIRMED loved ones' push handles
 * so the alert can cascade. Only `confirmed` links count (a pending request must
 * be accepted first — consent before we share someone's disaster status). Any
 * handle in `excludeTokens` (the direct in-zone push set) is dropped so a relative
 * who is themselves in the zone isn't double-notified. Each row is annotated with
 * the affected person it concerns.
 * @param {Array<{user_id:string, name:string}>} affected
 * @param {Set<string>} [excludeTokens] handles already pushed directly
 * @returns {Promise<Array<{token:string, platform:string, affectedName:string, affectedUserId:string, partnerUserId:string}>>}
 */
async function findLovedOneDevices(affected, excludeTokens = new Set()) {
  if (!affected || affected.length === 0) return [];
  const ids = affected.map((a) => a.user_id);
  const idSet = new Set(ids);
  const nameById = new Map(affected.map((a) => [a.user_id, a.name]));

  // Confirmed links touching an affected user; the PARTNER is the other side.
  const links = await collection('account_links').find({
    status: 'confirmed',
    $or: [{ user_a_id: { $in: ids } }, { user_b_id: { $in: ids } }],
  }).toArray();
  if (links.length === 0) return [];

  // One (affected → partner) pair per link, preserving row multiplicity.
  const linkPairs = links.map((al) => {
    const aIsAffected = idSet.has(al.user_a_id);
    return {
      affectedUserId: aIsAffected ? al.user_a_id : al.user_b_id,
      partnerUserId:  aIsAffected ? al.user_b_id : al.user_a_id,
    };
  });

  const partnerIds = [...new Set(linkPairs.map((p) => p.partnerUserId))];
  const devices = await collection('device_push_tokens')
    .find({ user_id: { $in: partnerIds } })
    .project({ token: 1, platform: 1, user_id: 1 })
    .toArray();
  const devsByUser = new Map();
  for (const d of devices) {
    if (!devsByUser.has(d.user_id)) devsByUser.set(d.user_id, []);
    devsByUser.get(d.user_id).push(d);
  }

  // Emit one row per (link × partner device) — the alert fan-out.
  const out = [];
  for (const { affectedUserId, partnerUserId } of linkPairs) {
    for (const d of devsByUser.get(partnerUserId) || []) {
      if (excludeTokens.has(d.token)) continue; // already got the direct in-zone alert
      out.push({
        token: d.token,
        platform: d.platform,
        affectedName: nameById.get(affectedUserId) || 'Your contact',
        affectedUserId,
        partnerUserId: d.user_id,
      });
    }
  }
  return out;
}

/**
 * All CONFIRMED loved ones (by user id) of a set of affected users — independent
 * of whether they have a push handle. This drives the OPEN-app socket path, which
 * must reach a relative who is connected but has no native push token (e.g. Expo
 * Go, or push simply unconfigured). Annotated with the affected person concerned.
 * @param {Array<{user_id:string, name:string}>} affected
 * @returns {Promise<Array<{affectedUserId:string, affectedName:string, partnerUserId:string}>>}
 */
async function findLovedOnePartners(affected) {
  if (!affected || affected.length === 0) return [];
  const ids = affected.map((a) => a.user_id);
  const idSet = new Set(ids);
  const nameById = new Map(affected.map((a) => [a.user_id, a.name]));
  const links = await collection('account_links').find({
    status: 'confirmed',
    $or: [{ user_a_id: { $in: ids } }, { user_b_id: { $in: ids } }],
  }).toArray();
  return links.map((al) => {
    const aIsAffected = idSet.has(al.user_a_id);
    const affectedUserId = aIsAffected ? al.user_a_id : al.user_b_id;
    return {
      affectedUserId,
      affectedName: nameById.get(affectedUserId) || 'Your contact',
      partnerUserId: aIsAffected ? al.user_b_id : al.user_a_id,
    };
  });
}

/**
 * Push + socket cascade for the family-notification feature. For everyone inside
 * the zone, alert their confirmed loved ones — a "your loved one may be affected"
 * notification that does NOT put the recipient into disaster mode. Two delivery
 * paths, decoupled on purpose:
 *   - CLOSED apps → Azure NH push to loved ones that have a device handle.
 *   - OPEN apps   → socket to ALL confirmed partners (no push handle required).
 * Returns dead device handles to prune.
 * @param {object} disaster
 * @param {Set<string>} directTokens handles already alerted directly (in-zone)
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<string[]>} dead device handles to delete
 */
async function cascadeToLovedOnes(disaster, directTokens, io) {
  const affected = await findAffectedUsersInRadius(disaster);
  if (affected.length === 0) return [];

  // (a) Closed apps: remote push to loved ones that registered a device handle.
  const lovedOneDevices = await findLovedOneDevices(affected, directTokens);
  const res = lovedOneDevices.length
    ? await pushService.sendLovedOneAlert(disaster, lovedOneDevices)
    : { deadTokens: [] };

  // (b) Open apps: socket to every confirmed partner, grouped per affected
  //     person so each relative is told WHO is affected — not just "someone".
  if (io) {
    const partners = await findLovedOnePartners(affected);
    const byAffected = new Map(); // affectedUserId → { name, partners:Set<string> }
    for (const p of partners) {
      if (!p.partnerUserId) continue;
      let g = byAffected.get(p.affectedUserId);
      if (!g) { g = { name: p.affectedName, partners: new Set() }; byAffected.set(p.affectedUserId, g); }
      g.partners.add(p.partnerUserId);
    }
    for (const [affectedUserId, g] of byAffected) {
      realtimeService.broadcastLovedOneAlert(io, [...g.partners], {
        disaster,
        affectedName: g.name,
        affectedUserId,
      });
    }
  }

  return res.deadTokens || [];
}

/**
 * Persist a disaster (unless a duplicate active one exists) and broadcast it.
 * @param {object} signal
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object | null>} the created disaster, or null if suppressed as duplicate
 */
async function activateDisaster(signal, io) {
  try {
    const duplicate = await findDuplicateActive(signal);
    if (duplicate) {
      return null;
    }

    const signalName = hkoSignal(signal.type, signal.severity);
    const disaster = {
      id: signal.id || crypto.randomUUID(),
      type: signal.type,
      magnitude: signal.magnitude ?? null,
      severity: signal.severity ?? null,
      lat: signal.lat,
      lng: signal.lng,
      radius_km: signal.radius_km,
      // Default the description to the HKO signal name so triggered disasters
      // carry locally-correct semantics even when the caller omits one.
      description: signal.description ?? (signalName ? `HKO ${signalName} in force.` : null),
      started_at: Date.now(),
      ended_at: null,
      active: true,
    };

    // Persist the disaster (id → _id). The partial-unique (type, active) index
    // is the backstop for a race the read-then-write findDuplicateActive can't
    // close: if a concurrent insert won, we get 11000 → return the existing
    // active disaster of this type instead of a 500 or a duplicate record.
    try {
      await collection('disasters').insertOne({
        _id: disaster.id,
        type: disaster.type,
        magnitude: disaster.magnitude,
        severity: disaster.severity,
        lat: disaster.lat,
        lng: disaster.lng,
        radius_km: disaster.radius_km,
        description: disaster.description,
        started_at: disaster.started_at,
        ended_at: disaster.ended_at,
        active: disaster.active,
      });
    } catch (err) {
      if (err.code === 11000) {
        const existing = await collection('disasters').findOne({ type: disaster.type, active: true });
        return existing ? mapId(existing) : null;
      }
      throw err;
    }

    // 1) Real-time socket alert — reaches mobile apps currently RUNNING.
    if (io) {
      realtimeService.broadcastDisasterAlert(io, disaster);
    }

    // 2) Remote push (Azure Notification Hubs) — reaches CLOSED apps. Two fan-outs:
    //    (a) DIRECT to devices inside the radius (the affected people) — drives
    //        their disaster-mode gate.
    //    (b) CASCADE to the CONFIRMED loved ones of everyone in the zone — a
    //        "your loved one may be affected" alert that does NOT trigger
    //        disaster mode for them. Relatives already alerted directly (they're
    //        in the zone too) are skipped to avoid a double notification.
    //    Fire-and-forget: push must never block or fail the activation, and skips
    //    cleanly when unconfigured. Dead handles (410/404) are pruned.
    (async () => {
      const directDevices = await findDevicesInRadius(disaster);
      const directRes = await pushService.sendDisasterPush(disaster, directDevices);

      const directTokens = new Set(directDevices.map((d) => d.token));
      const cascadeDead = await cascadeToLovedOnes(disaster, directTokens, io);

      const dead = [...(directRes.deadTokens || []), ...cascadeDead];
      if (dead.length) {
        await collection('device_push_tokens').deleteMany({ token: { $in: dead } });
      }
    })().catch((err) => logger.error('disaster_push_failed', { error: err.message }));

    return disaster;
  } catch (err) {
    logger.error('disaster_activation_failed', { error: err.message });
    throw err;
  }
}

/**
 * Evaluate the next mock signal and trigger if it crosses threshold.
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object | null>} the activated disaster or null
 */
async function checkFeeds(io) {
  try {
    const feeds = getMockDisasterFeeds();
    if (feeds.length === 0) return null; // feeds disabled — DB-driven only
    const signal = feeds[feedCursor % feeds.length];
    feedCursor += 1;

    if (shouldTrigger(signal)) {
      return await activateDisaster(signal, io);
    }
    return null;
  } catch (err) {
    logger.error('disaster_feed_check_failed', { error: err.message });
    return null;
  }
}

/**
 * Manual trigger from the webhook route. Mirrors activateDisaster.
 * @param {object} payload
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<object | null>}
 */
function triggerManual(payload, io) {
  return activateDisaster(payload, io);
}

/**
 * Begin polling the mock feeds at DISASTER_POLL_INTERVAL_MS.
 * @param {import('socket.io').Server} io
 */
function startPolling(io) {
  // No mock feed → disasters are gov/route-driven (triggerManual), so an idle
  // poll timer would only spin a leader-lock check every tick for nothing.
  // Skip it entirely (mirrors incidentEngine.startPolling).
  if (process.env.ENABLE_MOCK_FEEDS !== 'true') return;
  const { runIfLeader } = require('../lib/leaderLock');
  const interval = Number(process.env.DISASTER_POLL_INTERVAL_MS) || 30000;
  const ttl = Math.ceil(interval * 1.1); // hold slightly past one tick
  // Leader-gated so two instances don't both activate the same disaster.
  const tick = () => runIfLeader('trigger', ttl, () => checkFeeds(io))
    .catch((err) => logger.error('disaster_poll_failed', { error: err.message }));
  tick(); // run once immediately so the system feels alive on boot
  pollTimer = setInterval(tick, interval);
  if (pollTimer.unref) pollTimer.unref();
}

/**
 * Stop polling (tests / graceful shutdown).
 */
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Reset the rotating cursor (used by tests). */
function _resetCursor() {
  feedCursor = 0;
}

module.exports = {
  MAGNITUDE_THRESHOLD,
  SEVERITY_THRESHOLD,
  DUPLICATE_RADIUS_KM,
  HKO_TC_SIGNALS,
  HKO_RAINSTORM,
  hkoSignal,
  getMockDisasterFeeds,
  shouldTrigger,
  activateDisaster,
  findDevicesInRadius,
  findAffectedUsersInRadius,
  findLovedOneDevices,
  findLovedOnePartners,
  cascadeToLovedOnes,
  checkFeeds,
  triggerManual,
  startPolling,
  stopPolling,
  _resetCursor,
};
