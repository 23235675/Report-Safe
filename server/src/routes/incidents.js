'use strict';

const express = require('express');
const { authGuard, authenticate } = require('../lib/authGuard');
const { logAudit } = require('../lib/audit');
const { IncidentCreateSchema, IncidentRespondSchema } = require('../lib/zodSchemas');
const { validate, asyncHandler, HttpError } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');
const incidentEngine = require('../services/incidentEngine');
const incidentStore = require('../services/incidentStore');
const realtimeService = require('../services/realtimeService');

const { ACTIVE_RESPONSE } = incidentStore;

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

  // POST /api/incidents — create + dispatch (gov/CAD). THE integration seam.
  router.post('/', authGuard, validate(IncidentCreateSchema), asyncHandler(async (req, res) => {
    const result = await incidentEngine.activateIncident(req.valid, io);
    if (!result.incident) {
      return res.status(200).json({ ok: true, incident: null, message: 'Suppressed — an active incident already covers this location.' });
    }
    logAudit({ action: 'incident.create', entity: 'incidents', entityId: result.incident.id, details: { type: req.valid.type, matched: result.matched } });
    res.status(201).json({ ok: true, data: result.incident, matched: result.matched });
  }));

  // GET /api/incidents/active — dispatcher board (gov).
  router.get('/active', authGuard, asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await incidentStore.activeBoard() });
  }));

  // GET /api/incidents/nearby?lat&lng&radius — active incidents near a point
  // that THIS user is allowed to see. CFR is opt-in: only opted-in responders
  // get the feed, and residential incidents stay restricted via canView. No
  // PII is exposed — incidents carry only type + location.
  router.get('/nearby', authenticate, asyncHandler(async (req, res) => {
    if (req.auth.kind !== 'user') {
      throw new HttpError(403, 'Only a responder (user) may view nearby incidents.');
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Math.min(Number(req.query.radius) || 5, 20);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new HttpError(400, 'lat and lng are required.');
    }
    if (!(await incidentStore.responderOptedIn(req.auth.userId))) {
      return res.json({ ok: true, data: [] });
    }

    const rows = await incidentStore.nearbyActive(lat, lng, radiusKm);
    const data = rows
      .filter((i) => canView(req, i))
      .map((i) => ({
        id: i.id, type: i.type, lat: i.lat, lng: i.lng,
        is_public: i.is_public, status: i.status, created_at: i.created_at,
        distance_km: i.distance_km,
      }));
    res.json({ ok: true, data });
  }));

  // GET /api/incidents/:id — detail + nearest AEDs + co-responder roster.
  router.get('/:id', authenticate, asyncHandler(async (req, res) => {
    const incident = await incidentStore.getById(req.params.id);
    if (!canView(req, incident)) {
      throw new HttpError(403, 'Forbidden — this incident is restricted to verified responders.');
    }
    const [aeds, responders] = await Promise.all([
      incidentStore.nearestAeds(incident.lat, incident.lng),
      incidentStore.rosterFor(incident.id),
    ]);
    res.json({ ok: true, data: { incident, aeds, responders } });
  }));

  // POST /api/incidents/:id/respond — a responder sets status / position.
  router.post('/:id/respond', authenticate, validate(IncidentRespondSchema), asyncHandler(async (req, res) => {
    if (req.auth.kind !== 'user') {
      throw new HttpError(403, 'Only a responder (user) may respond to an incident.');
    }
    const incident = await incidentStore.getById(req.params.id);
    if (incident.status !== 'active') {
      throw new HttpError(409, 'This incident is no longer active.');
    }
    if (!canView(req, incident)) {
      throw new HttpError(403, 'Forbidden — this incident is restricted to verified responders.');
    }

    const { status, lat, lng, eta_seconds } = req.valid;
    await incidentStore.upsertResponse(req.params.id, req.auth.userId, req.valid);

    // Notify co-responders (everyone else on this incident) of the change.
    const others = await incidentStore.coResponderIds(req.params.id, req.auth.userId);
    if (io && others.length) {
      realtimeService.broadcastIncidentUpdate(io, others, {
        incidentId: req.params.id,
        response: {
          user_id: req.auth.userId,
          name: req.auth.user?.name || 'Responder',
          status,
          lat: ACTIVE_RESPONSE.has(status) ? (lat ?? null) : null,
          lng: ACTIVE_RESPONSE.has(status) ? (lng ?? null) : null,
          eta_seconds: eta_seconds ?? null,
        },
      });
    }
    res.json({ ok: true });
  }));

  // POST /api/incidents/:id/resolve — stand down (gov). Body: { status? }.
  router.post('/:id/resolve', authGuard, asyncHandler(async (req, res) => {
    const status = req.body?.status === 'stood_down' ? 'stood_down' : 'resolved';
    const incident = await incidentEngine.resolveIncident(req.params.id, status, io);
    if (!incident) throw new HttpError(404, 'No active incident with that id.');
    logAudit({ action: 'incident.resolve', entity: 'incidents', entityId: req.params.id, details: { status } });
    res.json({ ok: true, data: incident });
  }));

  // Router-scoped error handler; the app-level one in index.js is the backstop.
  router.use(errorHandler);

  return router;
};
