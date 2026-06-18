'use strict';

const express = require('express');
const crypto  = require('crypto');
const { collection } = require('../db/mongo');
const { authenticate, allowGovOrVolunteer } = require('../lib/authGuard');
const { boundingBox } = require('../services/reportStore');
const { haversineKm } = require('../lib/geo');
const { SafePlaceCreateSchema, SafePlaceQuerySchema } = require('../lib/zodSchemas');

/** Map a stored doc's _id → id. */
function mapId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}
/** Driver v6 findOneAndUpdate returns the doc directly; v5 wrapped it in {value}. */
function unwrap(res) {
  return res && res.value !== undefined ? res.value : res;
}

// Public list projection — never exposes the submitter, status, or review fields.
const PUBLIC_PROJECTION = { name: 1, lat: 1, lng: 1, description: 1, capacity: 1, disaster_id: 1, active: 1, created_at: 1 };

/**
 * Citizen-submitted refuge locations (R11 — the `safe_places` table existed
 * with no route). Reading is public (these are locations, not personal data);
 * submitting requires an authenticated user.
 */
module.exports = function createSafePlacesRouter() {
  const router = express.Router();

  // GET /api/safe-places — list active places, optionally within a radius.
  router.get('/', async (req, res) => {
    const parsed = SafePlaceQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { lat, lng, radius } = parsed.data;
    try {
      // PUBLIC list: only APPROVED, active places (pending/rejected stay hidden).
      const filter = { active: true, status: 'approved' };

      if (lat != null && lng != null) {
        const bb = boundingBox(lat, lng, radius);
        filter.lat = { $gte: bb.latMin, $lte: bb.latMax };
        filter.lng = { $gte: bb.lngMin, $lte: bb.lngMax };
        const docs = await collection('safe_places').find(filter).project(PUBLIC_PROJECTION).toArray();
        const within = [];
        for (const d of docs) {
          const distance_km = haversineKm(lat, lng, d.lat, d.lng);
          if (distance_km <= radius) within.push({ ...mapId(d), distance_km });
        }
        within.sort((a, b) => a.distance_km - b.distance_km);
        return res.json({ ok: true, safe_places: within });
      }

      const docs = await collection('safe_places').find(filter).project(PUBLIC_PROJECTION).sort({ created_at: -1 }).toArray();
      return res.json({ ok: true, safe_places: docs.map(mapId) });
    } catch (err) {
      console.error('[routes/safePlaces GET /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/safe-places — an authenticated user submits a refuge location.
  router.post('/', authenticate, async (req, res) => {
    if (req.auth.kind !== 'user') {
      return res.status(403).json({ error: 'A user account is required to submit a safe place.' });
    }
    const parsed = SafePlaceCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { name, lat, lng, description, capacity, disaster_id } = parsed.data;
    const id  = crypto.randomUUID();
    const now = Date.now();
    try {
      // No FK in Mongo: validate an unknown disaster_id up-front (was FK 23503 → 400).
      if (disaster_id) {
        const known = await collection('disasters').findOne({ _id: disaster_id }, { projection: { _id: 1 } });
        if (!known) return res.status(400).json({ error: 'Unknown disaster_id.' });
      }
      const doc = {
        _id: id, created_by_user_id: req.auth.userId, name, lat, lng,
        description: description ?? null, capacity: capacity ?? null,
        disaster_id: disaster_id ?? null, active: true, status: 'pending',
        reviewed_by: null, reviewed_at: null, created_at: now,
      };
      await collection('safe_places').insertOne(doc);
      return res.status(201).json({ ok: true, safe_place: mapId(doc) });
    } catch (err) {
      console.error('[routes/safePlaces POST /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/safe-places/pending — moderation queue (gov/volunteer only).
  // Returns submissions awaiting review, with the submitter's name/phone.
  router.get('/pending', allowGovOrVolunteer, async (req, res) => {
    try {
      const places = await collection('safe_places').find({ status: 'pending' }).sort({ created_at: 1 }).toArray();
      const creatorIds = [...new Set(places.map((p) => p.created_by_user_id).filter(Boolean))];
      const users = creatorIds.length
        ? await collection('users').find({ _id: { $in: creatorIds } }).project({ _id: 1, name: 1, phone: 1 }).toArray()
        : [];
      const byId = new Map(users.map((u) => [u._id, u]));

      const safe_places = places.map((p) => {
        const u = p.created_by_user_id ? byId.get(p.created_by_user_id) : null; // LEFT JOIN
        return {
          id: p._id, name: p.name, lat: p.lat, lng: p.lng, description: p.description,
          capacity: p.capacity, disaster_id: p.disaster_id, created_at: p.created_at,
          submitter_name: u ? u.name : null,
          submitter_phone: u ? u.phone : null,
        };
      });
      return res.json({ ok: true, safe_places });
    } catch (err) {
      console.error('[routes/safePlaces GET /pending] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/safe-places/:id/status — approve or decline (gov/volunteer only).
  router.put('/:id/status', allowGovOrVolunteer, async (req, res) => {
    const status = req.body?.status;
    if (status !== 'approved' && status !== 'rejected') {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    }
    const reviewer = req.auth?.user ? `${req.auth.user.name} (${req.auth.user.phone})` : 'gov';
    try {
      const result = await collection('safe_places').findOneAndUpdate(
        { _id: req.params.id, status: 'pending' },
        { $set: { status, reviewed_by: reviewer, reviewed_at: Date.now() } },
        { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) {
        return res.status(404).json({ error: 'Pending safe place not found (already reviewed?)' });
      }
      return res.json({ ok: true, safe_place: mapId(doc) });
    } catch (err) {
      console.error('[routes/safePlaces PUT /:id/status] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
