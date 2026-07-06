'use strict';

/*
 * CFR incident persistence: dispatcher board, responder feed, detail joins
 * (AEDs + roster), response upserts. All Mongo access for the `incidents` and
 * `incident_responses` collections. Creation/resolution lifecycles (dedupe +
 * alert fan-out) live in incidentEngine.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { findWithinRadius } = require('../lib/geo');
const { mapId } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');

/** Response statuses where a responder's live position is shared with the team. */
const ACTIVE_RESPONSE = new Set(['enroute', 'onscene']);

/** An incident by id (mapped), or a 404. */
async function getById(id) {
  const doc = await collection('incidents').findOne({ _id: id });
  if (!doc) throw new HttpError(404, 'Incident not found');
  return mapId(doc);
}

/**
 * Dispatcher board: active incidents + responder counts. Roster fetched in
 * ONE query and grouped (no N+1).
 */
async function activeBoard() {
  const incidents = await collection('incidents')
    .find({ status: 'active' })
    .sort({ created_at: -1 })
    .toArray();
  if (incidents.length === 0) return [];

  const ids = incidents.map((d) => d._id);
  const responses = await collection('incident_responses')
    .find({ incident_id: { $in: ids } })
    .project({ incident_id: 1, status: 1 })
    .toArray();
  const counts = new Map();
  for (const r of responses) {
    const c = counts.get(r.incident_id) || { responders: 0, enroute: 0, onscene: 0 };
    c.responders += 1;
    if (r.status === 'enroute') c.enroute += 1;
    if (r.status === 'onscene') c.onscene += 1;
    counts.set(r.incident_id, c);
  }
  return incidents.map((d) => ({
    ...mapId(d),
    responder_counts: counts.get(d._id) || { responders: 0, enroute: 0, onscene: 0 },
  }));
}

/** Active incidents within a radius (mapped, distance-sorted). */
function nearbyActive(lat, lng, radiusKm) {
  return findWithinRadius('incidents', {
    lat, lng, radiusKm, filter: { status: 'active' }, cap: null, map: mapId,
  });
}

/** PDPO opt-in consent gate: only opted-in responders receive the feed. */
async function responderOptedIn(userId) {
  const u = await collection('users').findOne({ _id: userId }, { projection: { responder_opt_in: 1 } });
  return !!u?.responder_opt_in;
}

/** Nearest active AEDs to a point. */
async function nearestAeds(lat, lng, radiusKm = 2, limit = 5) {
  const rows = await findWithinRadius('aed_locations', {
    lat, lng, radiusKm, filter: { active: true }, cap: null, map: mapId,
  });
  return rows.slice(0, limit);
}

/** Co-responder roster for an incident; positions only for active responders. */
async function rosterFor(incidentId) {
  const responses = await collection('incident_responses')
    .find({ incident_id: incidentId })
    .toArray();
  if (responses.length === 0) return [];
  const userIds = [...new Set(responses.map((r) => r.user_id))];
  const users = await collection('users')
    .find({ _id: { $in: userIds } })
    .project({ _id: 1, name: 1 })
    .toArray();
  const nameById = new Map(users.map((u) => [u._id, u.name || 'Responder']));
  return responses.map((r) => ({
    user_id: r.user_id,
    name: nameById.get(r.user_id) || 'Responder',
    status: r.status,
    eta_seconds: r.eta_seconds ?? null,
    // Share position only while actively responding (privacy).
    lat: ACTIVE_RESPONSE.has(r.status) ? (r.lat ?? null) : null,
    lng: ACTIVE_RESPONSE.has(r.status) ? (r.lng ?? null) : null,
    updated_at: r.updated_at,
  }));
}

/** Upsert one response row per (incident, responder). */
async function upsertResponse(incidentId, userId, { status, lat, lng, eta_seconds }) {
  const now = Date.now();
  await collection('incident_responses').updateOne(
    { incident_id: incidentId, user_id: userId },
    {
      $set: { status, lat: lat ?? null, lng: lng ?? null, eta_seconds: eta_seconds ?? null, updated_at: now },
      $setOnInsert: { _id: crypto.randomUUID(), incident_id: incidentId, user_id: userId, created_at: now },
    },
    { upsert: true }
  );
}

/** Everyone else responding to this incident (for the co-responder broadcast). */
async function coResponderIds(incidentId, excludeUserId) {
  const others = await collection('incident_responses')
    .find({ incident_id: incidentId, user_id: { $ne: excludeUserId } })
    .project({ user_id: 1 })
    .toArray();
  return others.map((r) => r.user_id);
}

module.exports = {
  ACTIVE_RESPONSE,
  getById,
  activeBoard,
  nearbyActive,
  responderOptedIn,
  nearestAeds,
  rosterFor,
  upsertResponse,
  coResponderIds,
};
