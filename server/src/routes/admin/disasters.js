'use strict';

const express = require('express');
const crypto  = require('crypto');
const { collection } = require('../../db/mongo');
const { unwrap } = require('../../lib/mongoMap');
const { blank, mapId, auditLog, actorLabel } = require('./shared');

// Mounted at /api/admin/disasters by index.js (after requireSuperAdmin).
module.exports = function adminDisastersRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const active = req.query.active; // 'true' | 'false' | undefined
    const type   = blank(req.query.type);

    const filter = {};
    if (active === 'true' || active === 'false') filter.active = (active === 'true');
    if (type) filter.type = type;

    try {
      const docs = await collection('disasters').find(filter).toArray();
      // ORDER BY active DESC, COALESCE(severity,0) DESC, started_at DESC LIMIT 200.
      docs.sort((a, b) => {
        const av = a.active ? 1 : 0, bv = b.active ? 1 : 0;
        if (av !== bv) return bv - av;
        const as = a.severity ?? 0, bs = b.severity ?? 0;
        if (as !== bs) return bs - as;
        return (b.started_at || 0) - (a.started_at || 0);
      });
      return res.json({ ok: true, data: docs.slice(0, 200).map(mapId) });
    } catch (err) {
      console.error('[admin/disasters GET]', err);
      return res.status(500).json({ error: 'Failed to list disasters' });
    }
  });

  router.post('/', async (req, res) => {
    const { type, magnitude, severity, lat, lng, radius_km, description, active = true } = req.body || {};
    if (!type || lat == null || lng == null || !radius_km) {
      return res.status(400).json({ error: 'type, lat, lng, radius_km are required' });
    }
    try {
      const id  = crypto.randomUUID();
      const now = Date.now();
      const doc = {
        _id: id, type, magnitude: magnitude ?? null, severity: severity ?? null,
        lat, lng, radius_km, description: description ?? null, active,
        started_at: now, ended_at: null,
      };
      await collection('disasters').insertOne(doc);
      await auditLog('create', 'disasters', id, actorLabel(req), { type, lat, lng });
      return res.status(201).json({ ok: true, data: mapId(doc) });
    } catch (err) {
      console.error('[admin/disasters POST]', err);
      return res.status(500).json({ error: 'Failed to create disaster' });
    }
  });

  router.put('/:id', async (req, res) => {
    const { type, magnitude, severity, lat, lng, radius_km, description, active, ended_at } = req.body || {};
    try {
      const set = {};
      const typeVal = blank(type);             if (typeVal !== null) set.type = typeVal;
      const magVal = blank(magnitude);          if (magVal !== null) set.magnitude = magVal;
      const sevVal = blank(severity);           if (sevVal !== null) set.severity = sevVal;
      const latVal = blank(lat);                if (latVal !== null) set.lat = latVal;
      const lngVal = blank(lng);                if (lngVal !== null) set.lng = lngVal;
      const radVal = blank(radius_km);          if (radVal !== null) set.radius_km = radVal;
      const descVal = blank(description);       if (descVal !== null) set.description = descVal;
      if (active !== undefined && active !== null) set.active = active;
      const endedVal = blank(ended_at);         if (endedVal !== null) set.ended_at = endedVal;

      const result = await collection('disasters').findOneAndUpdate(
        { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Disaster not found' });
      await auditLog('update', 'disasters', req.params.id, actorLabel(req), { type, active });
      return res.json({ ok: true, data: mapId(doc) });
    } catch (err) {
      console.error('[admin/disasters PUT]', err);
      return res.status(500).json({ error: 'Failed to update disaster' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const removed = unwrap(await collection('disasters').findOneAndDelete(
        { _id: req.params.id }, { projection: { type: 1 } }
      ));
      if (!removed) return res.status(404).json({ error: 'Disaster not found' });
      // reports.disaster_id had ON DELETE SET NULL — emulate it.
      await collection('reports').updateMany({ disaster_id: req.params.id }, { $set: { disaster_id: null } });
      await auditLog('delete', 'disasters', req.params.id, actorLabel(req), { type: removed.type });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[admin/disasters DELETE]', err);
      return res.status(500).json({ error: 'Failed to delete disaster' });
    }
  });

  return router;
};
