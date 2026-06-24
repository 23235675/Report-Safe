'use strict';

const express = require('express');
const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { authGuard, authenticate } = require('../lib/authGuard');
const { logAudit } = require('../lib/audit');
const { boxFilter } = require('../services/reportStore');
const { haversineKm } = require('../lib/geo');
const { IncidentCreateSchema, IncidentRespondSchema } = require('../lib/zodSchemas');
const { mapId } = require('../lib/mongoMap');
const incidentEngine = require('../services/incidentEngine');
const realtimeService = require('../services/realtimeService');

/** Response statuses where a responder's live position is shared with the team. */
const ACTIVE_RESPONSE = new Set(['enroute', 'onscene']);

module.exports = function createIncidentsRouter(io) {
  const router = express.Router();

  /**
   * Privacy gate: a residential incident (is_public=false) is visible only to
   * verified responders (gov token, or a user with role='government').
   */
  function canView(req, incident) {
    if (incident.is_public) return true;
    return req.auth?.kind === 'gov' || req.auth?.user?.role === 'government';
  }

  /** Nearest active AEDs to a point (same geo pattern as shelters). */
  async function nearestAeds(lat, lng, radiusKm = 2, limit = 5) {
    const docs = await collection('aed_locations').find({
      active: true,
      ...boxFilter(lat, lng, radiusKm),
    }).toArray();
    return docs
      .map((d) => ({ ...mapId(d), distance_km: haversineKm(lat, lng, d.lat, d.lng) }))
      .filter((d) => d.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, limit);
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
      // Share position only while actively responding (privacy §8.4).
      lat: ACTIVE_RESPONSE.has(r.status) ? (r.lat ?? null) : null,
      lng: ACTIVE_RESPONSE.has(r.status) ? (r.lng ?? null) : null,
      updated_at: r.updated_at,
    }));
  }

  // POST /api/incidents — create + dispatch (gov/CAD). THE integration seam.
  router.post('/', authGuard, async (req, res) => {
    const parsed = IncidentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    try {
      const result = await incidentEngine.activateIncident(parsed.data, io);
      if (!result.incident) {
        return res.status(200).json({ ok: true, incident: null, message: 'Suppressed — an active incident already covers this location.' });
      }
      logAudit({ action: 'incident.create', entity: 'incidents', entityId: result.incident.id, details: { type: parsed.data.type, matched: result.matched } });
      return res.status(201).json({ ok: true, data: result.incident, matched: result.matched });
    } catch (err) {
      console.error('[routes/incidents POST /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/incidents/active — dispatcher board (gov). Active incidents +
  // responder counts. Roster fetched in ONE query and grouped (no N+1).
  router.get('/active', authGuard, async (req, res) => {
    try {
      const incidents = await collection('incidents')
        .find({ status: 'active' })
        .sort({ created_at: -1 })
        .toArray();
      if (incidents.length === 0) return res.json({ ok: true, data: [] });

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
      const data = incidents.map((d) => ({
        ...mapId(d),
        responder_counts: counts.get(d._id) || { responders: 0, enroute: 0, onscene: 0 },
      }));
      return res.json({ ok: true, data });
    } catch (err) {
      console.error('[routes/incidents GET /active] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/incidents/nearby?lat&lng&radius — active incidents near a point
  // that THIS user is allowed to see. CFR is opt-in: only users who opted in as
  // responders get this feed, and residential (is_public=false) incidents stay
  // restricted to verified (gov) responders via canView. No PII is exposed —
  // incidents carry only type + location.
  router.get('/nearby', authenticate, async (req, res) => {
    if (req.auth.kind !== 'user') {
      return res.status(403).json({ error: 'Only a responder (user) may view nearby incidents.' });
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Math.min(Number(req.query.radius) || 5, 20);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng are required.' });
    }
    try {
      // Opt-in consent gate (PDPO): non-responders never receive this feed.
      const me = await collection('users').findOne(
        { _id: req.auth.userId },
        { projection: { responder_opt_in: 1 } }
      );
      if (!me?.responder_opt_in) return res.json({ ok: true, data: [] });

      const docs = await collection('incidents').find({
        status: 'active',
        ...boxFilter(lat, lng, radiusKm),
      }).toArray();
      const data = docs
        .map((d) => mapId(d))
        .filter((i) => canView(req, i))
        .map((i) => ({
          id: i.id, type: i.type, lat: i.lat, lng: i.lng,
          is_public: i.is_public, status: i.status, created_at: i.created_at,
          distance_km: haversineKm(lat, lng, i.lat, i.lng),
        }))
        .filter((i) => i.distance_km <= radiusKm)
        .sort((a, b) => a.distance_km - b.distance_km);
      return res.json({ ok: true, data });
    } catch (err) {
      console.error('[routes/incidents GET /nearby] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/incidents/:id — detail + nearest AEDs + co-responder roster.
  router.get('/:id', authenticate, async (req, res) => {
    try {
      const doc = await collection('incidents').findOne({ _id: req.params.id });
      if (!doc) return res.status(404).json({ error: 'Incident not found' });
      const incident = mapId(doc);
      if (!canView(req, incident)) {
        return res.status(403).json({ error: 'Forbidden — this incident is restricted to verified responders.' });
      }
      const [aeds, responders] = await Promise.all([
        nearestAeds(incident.lat, incident.lng),
        rosterFor(incident.id),
      ]);
      return res.json({ ok: true, data: { incident, aeds, responders } });
    } catch (err) {
      console.error('[routes/incidents GET /:id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/incidents/:id/respond — a responder sets status / position.
  router.post('/:id/respond', authenticate, async (req, res) => {
    if (req.auth.kind !== 'user') {
      return res.status(403).json({ error: 'Only a responder (user) may respond to an incident.' });
    }
    const parsed = IncidentRespondSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    try {
      const incident = await collection('incidents').findOne({ _id: req.params.id });
      if (!incident) return res.status(404).json({ error: 'Incident not found' });
      if (incident.status !== 'active') {
        return res.status(409).json({ error: 'This incident is no longer active.' });
      }
      if (!canView(req, mapId(incident))) {
        return res.status(403).json({ error: 'Forbidden — this incident is restricted to verified responders.' });
      }

      const { status, lat, lng, eta_seconds } = parsed.data;
      const now = Date.now();
      const userId = req.auth.userId;
      // Upsert one response row per (incident, responder).
      await collection('incident_responses').updateOne(
        { incident_id: req.params.id, user_id: userId },
        {
          $set: { status, lat: lat ?? null, lng: lng ?? null, eta_seconds: eta_seconds ?? null, updated_at: now },
          $setOnInsert: { _id: crypto.randomUUID(), incident_id: req.params.id, user_id: userId, created_at: now },
        },
        { upsert: true }
      );

      // Notify co-responders (everyone else on this incident) of the change.
      const others = await collection('incident_responses')
        .find({ incident_id: req.params.id, user_id: { $ne: userId } })
        .project({ user_id: 1 })
        .toArray();
      const coResponderIds = others.map((r) => r.user_id);
      if (io && coResponderIds.length) {
        realtimeService.broadcastIncidentUpdate(io, coResponderIds, {
          incidentId: req.params.id,
          response: {
            user_id: userId,
            name: req.auth.user?.name || 'Responder',
            status,
            lat: ACTIVE_RESPONSE.has(status) ? (lat ?? null) : null,
            lng: ACTIVE_RESPONSE.has(status) ? (lng ?? null) : null,
            eta_seconds: eta_seconds ?? null,
          },
        });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error('[routes/incidents POST /:id/respond] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/incidents/:id/resolve — stand down (gov). Body: { status? }.
  router.post('/:id/resolve', authGuard, async (req, res) => {
    const status = req.body?.status === 'stood_down' ? 'stood_down' : 'resolved';
    try {
      const incident = await incidentEngine.resolveIncident(req.params.id, status, io);
      if (!incident) return res.status(404).json({ error: 'No active incident with that id.' });
      logAudit({ action: 'incident.resolve', entity: 'incidents', entityId: req.params.id, details: { status } });
      return res.json({ ok: true, data: incident });
    } catch (err) {
      console.error('[routes/incidents POST /:id/resolve] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
