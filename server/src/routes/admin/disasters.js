'use strict';

const express = require('express');
const crypto  = require('crypto');
const { collection } = require('../../db/mongo');
const { unwrap } = require('../../lib/mongoMap');
const { HttpError, asyncHandler, validate } = require('../../lib/http');
const { AdminDisasterCreateSchema, AdminDisasterUpdateSchema } = require('../../lib/zodSchemas');
const { blank, mapId, auditLog, actorLabel } = require('./shared');

// Mounted at /api/admin/disasters by index.js (after requireSuperAdmin).
module.exports = function adminDisastersRouter() {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const active = req.query.active; // 'true' | 'false' | undefined
    const type   = blank(req.query.type);

    const filter = {};
    if (active === 'true' || active === 'false') filter.active = (active === 'true');
    if (type) filter.type = type;

    const docs = await collection('disasters').find(filter).toArray();
    // ORDER BY active DESC, COALESCE(severity,0) DESC, started_at DESC LIMIT 200.
    docs.sort((a, b) => {
      const av = a.active ? 1 : 0, bv = b.active ? 1 : 0;
      if (av !== bv) return bv - av;
      const as = a.severity ?? 0, bs = b.severity ?? 0;
      if (as !== bs) return bs - as;
      return (b.started_at || 0) - (a.started_at || 0);
    });
    res.json({ ok: true, data: docs.slice(0, 200).map(mapId) });
  }));

  router.post('/', validate(AdminDisasterCreateSchema), asyncHandler(async (req, res) => {
    const { type, magnitude, severity, lat, lng, radius_km, description, active = true } = req.valid;
    if (!type || lat == null || lng == null || !radius_km) {
      throw new HttpError(400, 'type, lat, lng, radius_km are required');
    }
    const id  = crypto.randomUUID();
    const now = Date.now();
    const doc = {
      _id: id, type, magnitude: magnitude ?? null, severity: severity ?? null,
      lat, lng, radius_km, description: description ?? null, active,
      started_at: now, ended_at: null,
    };
    await collection('disasters').insertOne(doc);
    await auditLog('create', 'disasters', id, actorLabel(req), { type, lat, lng });
    res.status(201).json({ ok: true, data: mapId(doc) });
  }));

  router.put('/:id', validate(AdminDisasterUpdateSchema), asyncHandler(async (req, res) => {
    const { type, magnitude, severity, lat, lng, radius_km, description, active, ended_at } = req.valid;
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
    if (!doc) throw new HttpError(404, 'Disaster not found');
    await auditLog('update', 'disasters', req.params.id, actorLabel(req), { type, active });
    res.json({ ok: true, data: mapId(doc) });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = unwrap(await collection('disasters').findOneAndDelete(
      { _id: req.params.id }, { projection: { type: 1 } }
    ));
    if (!removed) throw new HttpError(404, 'Disaster not found');
    // reports.disaster_id had ON DELETE SET NULL — emulate it.
    await collection('reports').updateMany({ disaster_id: req.params.id }, { $set: { disaster_id: null } });
    await auditLog('delete', 'disasters', req.params.id, actorLabel(req), { type: removed.type });
    res.json({ ok: true });
  }));

  return router;
};
