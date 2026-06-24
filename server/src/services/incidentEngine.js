'use strict';

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { boxFilter, fromDoc } = require('./reportStore');
const { haversineKm } = require('../lib/geo');
const realtimeService = require('./realtimeService');
const pushService = require('../lib/pushService');

/**
 * Community First Responder (CFR) incident engine.
 *
 * An "incident" is a 999/CAD point dispatch (cardiac arrest, fire, …) that needs
 * nearby opted-in volunteers in the minutes before the ambulance arrives. This
 * mirrors triggerEngine.activateDisaster, but the alert is OPT-IN and NON-GATING:
 * it reaches volunteers (not the victim) and never forces disaster mode.
 *
 * Reuses the same PostGIS-free geo math as everything else (bounding-box
 * prefilter + JS haversine) so it runs identically on Cosmos.
 */

/** Two active incidents of the same type within this distance are duplicates. */
const DEDUPE_KM = (Number(process.env.INCIDENT_DEDUPE_RADIUS_M) || 150) / 1000;
/** Default responder radius when a profile omits one (≈ walking distance). */
const DEFAULT_RADIUS_KM = Number(process.env.INCIDENT_DEFAULT_RADIUS_KM) || 1.0;
/** Scan ceiling for geo bounding-box queries (C2) — see reportStore GEO_SCAN_CAP. */
const GEO_SCAN_CAP = Number(process.env.GEO_SCAN_CAP) || 5000;

/** Map an incident type to the responder skill it requires. */
function skillForType(type) {
  if (type === 'fire') return 'fire';
  return 'cpr'; // cardiac_arrest, trauma, other → CPR/first-aid capable
}

/**
 * Find an existing ACTIVE incident of the same type within DEDUPE_KM — so a
 * double-dispatch of the same event doesn't double-alert responders.
 * @param {object} payload
 * @returns {Promise<object | undefined>}
 */
async function findDuplicateActive(payload) {
  const candidates = await collection('incidents').find({
    status: 'active',
    type: payload.type,
    ...boxFilter(payload.lat, payload.lng, DEDUPE_KM),
  }).toArray();
  const match = candidates.find(
    (d) => haversineKm(payload.lat, payload.lng, d.lat, d.lng) <= DEDUPE_KM
  );
  return match ? fromDoc(match) : undefined;
}

/**
 * Find opted-in responders eligible for an incident:
 *   - opt-in + carries the required skill, and
 *   - PRIVACY GATE: a residential (is_public=false) incident is restricted to
 *     verified (role='government') responders — PulsePoint's residential model, and
 *   - has a live device location within THEIR OWN max response radius.
 *
 * Returns one row per matched responder with their device handles (for push)
 * and id/name (for the socket + co-responder roster). The widest responder
 * radius sizes the bounding box; each responder is then filtered by their own.
 *
 * @param {object} incident
 * @returns {Promise<Array<{user_id:string, name:string, distance_km:number, devices:Array<{token:string,platform:string}>}>>}
 */
async function findRespondersInRadius(incident) {
  const skill = skillForType(incident.type);
  const filter = { responder_opt_in: true, responder_skills: skill };
  if (!incident.is_public) filter.role = 'government'; // residential → verified only

  const candidates = await collection('users')
    .find(filter)
    .project({ _id: 1, name: 1, responder_max_radius_km: 1 })
    .toArray();
  if (candidates.length === 0) return [];

  const radiusById = new Map(
    candidates.map((u) => [u._id, Number(u.responder_max_radius_km) || DEFAULT_RADIUS_KM])
  );
  const nameById = new Map(
    candidates.map((u) => [u._id, (u.name && u.name.trim()) ? u.name : 'Responder'])
  );
  const maxRadius = Math.max(...radiusById.values());

  // Live locations from the device registry: scoped to the candidate responders
  // (indexed user_id $in — already a small set) and bounded by the widest radius
  // box. Each responder is then filtered by THEIR OWN radius via haversine.
  const devices = await collection('device_push_tokens').find({
    user_id: { $in: [...radiusById.keys()] },
    ...boxFilter(incident.lat, incident.lng, maxRadius),
  }).project({ _id: 0, token: 1, platform: 1, user_id: 1, lat: 1, lng: 1 })
    .sort({ lat: 1 }).limit(GEO_SCAN_CAP).toArray();

  // Group devices per responder; a responder matches if ANY device is within
  // their own radius. Their distance = closest device.
  const byUser = new Map();
  for (const d of devices) {
    const dist = haversineKm(incident.lat, incident.lng, d.lat, d.lng);
    if (dist > radiusById.get(d.user_id)) continue; // outside THIS responder's radius
    let g = byUser.get(d.user_id);
    if (!g) { g = { distance_km: dist, devices: [] }; byUser.set(d.user_id, g); }
    if (dist < g.distance_km) g.distance_km = dist;
    g.devices.push({ token: d.token, platform: d.platform });
  }

  return [...byUser.entries()].map(([user_id, g]) => ({
    user_id,
    name: nameById.get(user_id),
    distance_km: g.distance_km,
    devices: g.devices,
  }));
}

/**
 * Persist an incident (unless a duplicate active one exists) and alert nearby
 * responders over both transports (socket = open apps, push = closed apps).
 * @param {object} payload validated by IncidentCreateSchema
 * @param {import('socket.io').Server} [io]
 * @returns {Promise<{incident:object, matched:number} | {incident:null}>}
 */
async function activateIncident(payload, io) {
  const duplicate = await findDuplicateActive(payload);
  if (duplicate) return { incident: null, duplicate: true };

  const incident = {
    id: payload.id || crypto.randomUUID(),
    type: payload.type,
    status: 'active',
    lat: payload.lat,
    lng: payload.lng,
    address: payload.address ?? null,
    is_public: payload.is_public !== false,
    notes: payload.notes ?? null,
    source: payload.source || 'manual',
    created_at: Date.now(),
    resolved_at: null,
  };

  await collection('incidents').insertOne({ _id: incident.id, ...withoutId(incident) });

  const responders = await findRespondersInRadius(incident);

  // 1) Socket — open apps. Targeted by matched responder ids.
  if (io && responders.length) {
    realtimeService.broadcastResponderAlert(io, responders.map((r) => r.user_id), incident);
  }

  // 2) Push — closed apps. Fire-and-forget; must never block/fail the dispatch.
  (async () => {
    const devices = responders.flatMap((r) => r.devices);
    if (!devices.length) return;
    const res = await pushService.sendResponderAlert(incident, devices);
    if (res.deadTokens && res.deadTokens.length) {
      await collection('device_push_tokens').deleteMany({ token: { $in: res.deadTokens } });
    }
  })().catch((err) => console.error('[incidentEngine] responder push failed:', err.message));

  return { incident, matched: responders.length };
}

/** Strip the `id` key so it isn't duplicated alongside `_id` in the doc. */
function withoutId(o) {
  const { id, ...rest } = o;
  return rest;
}

/**
 * Resolve / stand down an active incident and notify responders so their
 * screens close. Returns the updated incident or null if none was active.
 * @param {string} id
 * @param {'resolved'|'stood_down'} status
 * @param {import('socket.io').Server} [io]
 */
async function resolveIncident(id, status, io) {
  const { unwrap } = require('../lib/mongoMap');
  const result = await collection('incidents').findOneAndUpdate(
    { _id: id, status: 'active' },
    { $set: { status, resolved_at: Date.now() } },
    { returnDocument: 'after' }
  );
  const doc = unwrap(result);
  if (!doc) return null;
  if (io) realtimeService.broadcastIncidentResolved(io, id);
  return fromDoc(doc);
}

// ── Optional mock 999 feed (demos only) ──────────────────────────────
let pollTimer = null;
let feedCursor = 0;

/** Demo dispatches near the seeded HK disasters. Off unless ENABLE_MOCK_999_FEED=true. */
function getMockIncidentFeeds() {
  if (process.env.ENABLE_MOCK_999_FEED !== 'true') return [];
  return [
    { type: 'cardiac_arrest', lat: 22.302, lng: 114.177, is_public: true, source: 'mock_feed', notes: 'Demo: adult collapsed, no pulse — Central.' },
    { type: 'fire',           lat: 22.336, lng: 114.193, is_public: true, source: 'mock_feed', notes: 'Demo: small unit fire — Kowloon East.' },
  ];
}

async function checkFeeds(io) {
  const feeds = getMockIncidentFeeds();
  if (feeds.length === 0) return null;
  const signal = feeds[feedCursor % feeds.length];
  feedCursor += 1;
  try {
    return await activateIncident(signal, io);
  } catch (err) {
    console.error('[incidentEngine.checkFeeds] failed:', err.message);
    return null;
  }
}

/** Begin polling the mock feed (leader-gated, like triggerEngine). No-op unless enabled. */
function startPolling(io) {
  if (process.env.ENABLE_MOCK_999_FEED !== 'true') return;
  const { runIfLeader } = require('../lib/leaderLock');
  const interval = Number(process.env.INCIDENT_POLL_INTERVAL_MS) || 60000;
  const ttl = Math.ceil(interval * 1.1);
  const tick = () => runIfLeader('incident', ttl, () => checkFeeds(io))
    .catch((err) => console.error('[incidentEngine.startPolling] poll failed:', err.message));
  pollTimer = setInterval(tick, interval);
  if (pollTimer.unref) pollTimer.unref();
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function _resetCursor() { feedCursor = 0; }

module.exports = {
  DEDUPE_KM,
  DEFAULT_RADIUS_KM,
  skillForType,
  findDuplicateActive,
  findRespondersInRadius,
  activateIncident,
  resolveIncident,
  getMockIncidentFeeds,
  checkFeeds,
  startPolling,
  stopPolling,
  _resetCursor,
};
