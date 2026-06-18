'use strict';

const express  = require('express');
const crypto   = require('crypto');
const { collection } = require('../db/mongo');
const { allowGovOrVolunteer } = require('../lib/authGuard');
const { logAudit }  = require('../lib/audit');
const { boundingBox } = require('../services/reportStore');
const { haversineKm } = require('../lib/geo');
const { ShelterQuerySchema, ShelterCreateSchema, ShelterUpdateSchema } = require('../lib/zodSchemas');

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

module.exports = function createSheltersRouter() {
  const router = express.Router();

  // GET /api/shelters — list shelters; optionally filter by location radius or disaster_id
  router.get('/', async (req, res) => {
    const parsed = ShelterQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { lat, lng, radius, disaster_id, source } = parsed.data;
    try {
      const filter = { active: true };
      if (disaster_id) filter.disaster_id = disaster_id;
      if (source) filter.source = source;

      if (lat != null && lng != null) {
        // Bounding-box prefilter (index-friendly) + exact haversine, then sort by distance.
        const bb = boundingBox(lat, lng, radius);
        filter.lat = { $gte: bb.latMin, $lte: bb.latMax };
        filter.lng = { $gte: bb.lngMin, $lte: bb.lngMax };
        const docs = await collection('shelters').find(filter).toArray();
        const within = [];
        for (const d of docs) {
          const distance_km = haversineKm(lat, lng, d.lat, d.lng);
          if (distance_km <= radius) within.push({ ...mapId(d), distance_km });
        }
        within.sort((a, b) => a.distance_km - b.distance_km);
        return res.json({ ok: true, shelters: within });
      }

      const docs = await collection('shelters').find(filter).sort({ name: 1 }).toArray();
      return res.json({ ok: true, shelters: docs.map(mapId) });
    } catch (err) {
      console.error('[routes/shelters GET /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/shelters/:id — single shelter detail
  router.get('/:id', async (req, res) => {
    try {
      const doc = await collection('shelters').findOne({ _id: req.params.id });
      if (!doc) return res.status(404).json({ error: 'Shelter not found' });
      return res.json({ ok: true, shelter: mapId(doc) });
    } catch (err) {
      console.error('[routes/shelters GET /:id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/shelters — create shelter (gov token OR volunteer/government user)
  router.post('/', allowGovOrVolunteer, async (req, res) => {
    const parsed = ShelterCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const {
      name, lat, lng, capacity, current_count, phone, address,
      contact_name, hours_open, source, type, disaster_id,
    } = parsed.data;
    const now = Date.now();
    const id  = crypto.randomUUID();
    try {
      const doc = {
        _id: id, name, type, source, lat, lng,
        capacity: capacity ?? null, current_count: current_count ?? 0,
        address: address ?? null, phone: phone ?? null, contact_name: contact_name ?? null,
        hours_open: hours_open ?? null, disaster_id: disaster_id ?? null, active: true,
        created_at: now, updated_at: now,
      };
      await collection('shelters').insertOne(doc);
      logAudit({ action: 'shelter.create', entity: 'shelters', entityId: id, details: { name, type, source } });
      return res.status(201).json({ ok: true, shelter: mapId(doc) });
    } catch (err) {
      console.error('[routes/shelters POST /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/shelters/:id — update shelter (gov token OR volunteer/government user)
  router.put('/:id', allowGovOrVolunteer, async (req, res) => {
    const parsed = ShelterUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { name, capacity, current_count, phone, address, contact_name, hours_open, active } = parsed.data;
    try {
      const set = { updated_at: Date.now() };
      if (name != null) set.name = name;
      if (capacity != null) set.capacity = capacity;
      if (current_count != null) set.current_count = current_count;
      if (phone != null) set.phone = phone;
      if (address != null) set.address = address;
      if (contact_name != null) set.contact_name = contact_name;
      if (hours_open != null) set.hours_open = hours_open;
      if (active != null) set.active = active;

      const result = await collection('shelters').findOneAndUpdate(
        { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Shelter not found' });
      logAudit({ action: 'shelter.update', entity: 'shelters', entityId: req.params.id, details: parsed.data });
      return res.json({ ok: true, shelter: mapId(doc) });
    } catch (err) {
      console.error('[routes/shelters PUT /:id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/shelters/:id — soft-delete shelter (gov token OR volunteer/government user)
  router.delete('/:id', allowGovOrVolunteer, async (req, res) => {
    try {
      await collection('shelters').updateOne(
        { _id: req.params.id }, { $set: { active: false, updated_at: Date.now() } }
      );
      logAudit({ action: 'shelter.deactivate', entity: 'shelters', entityId: req.params.id });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[routes/shelters DELETE /:id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
