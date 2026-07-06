'use strict';

const express = require('express');
const crypto  = require('crypto');
const { collection } = require('../../db/mongo');
const { ilike, unwrap } = require('../../lib/mongoMap');
const { HttpError, asyncHandler, validate } = require('../../lib/http');
const { AdminReportCreateSchema, AdminReportUpdateSchema } = require('../../lib/zodSchemas');
const { blank, VALID_REPORT_STATUS, mapId, auditLog, actorLabel } = require('./shared');

// Urgency ordering — the statuses an EOC must act on float to the top.
const URGENCY_BRANCHES = [
  ['need_help', 1], ['missing', 2], ['verified_missing', 3], ['potentially_missing', 4],
  ['injured', 5], ['awaiting_response', 6], ['deceased', 7], ['rescued', 8], ['safe', 9],
].map(([s, n]) => ({ case: { $eq: ['$status', s] }, then: n }));

// Mounted at /api/admin/reports by index.js (after requireSuperAdmin).
module.exports = function adminReportsRouter() {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    const status     = blank(req.query.status);
    const reportedBy = blank(req.query.reported_by);
    const userType   = blank(req.query.user_type);
    const disasterId = req.query.disaster_id; // id | '__any__' | '__none__' | undefined

    const filter = {};
    const and = [];
    if (req.query.q) {
      const rx = ilike(req.query.q);
      and.push({ $or: [{ name: rx }, { phone: rx }] });
    }
    if (status)     filter.status = status;
    if (reportedBy) filter.reported_by = reportedBy;
    if (userType)   filter.user_type = userType;
    if (disasterId === '__none__')     filter.disaster_id = null;
    else if (disasterId === '__any__') filter.disaster_id = { $ne: null };
    else if (blank(disasterId))        filter.disaster_id = disasterId;
    if (and.length) filter.$and = and;

    const [page, total] = await Promise.all([
      collection('reports').aggregate([
        { $match: filter },
        { $addFields: { _urgency: { $switch: { branches: URGENCY_BRANCHES, default: 10 } } } },
        { $sort: { _urgency: 1, updated_at: -1 } },
        { $skip: offset },
        { $limit: limit },
      ]).toArray(),
      collection('reports').countDocuments(filter),
    ]);

    // LEFT JOIN users → user_name / user_phone.
    const userIds = [...new Set(page.map((r) => r.user_id).filter(Boolean))];
    const users = userIds.length
      ? await collection('users').find({ _id: { $in: userIds } }).project({ _id: 1, name: 1, phone: 1 }).toArray()
      : [];
    const byId = new Map(users.map((u) => [u._id, u]));

    const rows = page.map((r) => {
      const u = r.user_id ? byId.get(r.user_id) : null;
      const { _id, name_lower, _urgency, ...rest } = r;
      return { id: _id, ...rest, user_name: u ? u.name : null, user_phone: u ? u.phone : null };
    });
    res.json({ ok: true, data: rows, meta: { total } });
  }));

  router.post('/', validate(AdminReportCreateSchema), asyncHandler(async (req, res) => {
    const { name, status, lat, lng, medical_notes, phone, personal_id, disaster_id, user_id } = req.valid;
    if (!name || !status || lat == null || lng == null) {
      throw new HttpError(400, 'name, status, lat, lng are required');
    }
    if (!VALID_REPORT_STATUS.includes(status)) {
      throw new HttpError(400, `status must be one of: ${VALID_REPORT_STATUS.join(', ')}`);
    }
    const id  = crypto.randomUUID();
    const now = Date.now();
    const doc = {
      _id: id, name, name_lower: String(name).toLowerCase(), status, lat, lng,
      medical_notes: medical_notes ?? null, phone: phone ?? null,
      personal_id: personal_id ?? null, disaster_id: disaster_id ?? null,
      relay_count: 0, reported_by: null, reporter_name: null, user_type: 'mobile',
      user_id: user_id ?? null, reported_for_user_id: null,
      created_at: now, updated_at: now,
    };
    await collection('reports').insertOne(doc);
    await auditLog('create', 'reports', id, actorLabel(req), { name, status });
    res.status(201).json({ ok: true, data: mapId(doc) });
  }));

  router.put('/:id', validate(AdminReportUpdateSchema), asyncHandler(async (req, res) => {
    const { name, status, lat, lng, medical_notes, phone, personal_id, disaster_id } = req.valid;
    if (blank(status) && !VALID_REPORT_STATUS.includes(status)) {
      throw new HttpError(400, `status must be one of: ${VALID_REPORT_STATUS.join(', ')}`);
    }
    const set = { updated_at: Date.now() };
    const nameVal = blank(name);
    if (nameVal !== null) { set.name = nameVal; set.name_lower = String(nameVal).toLowerCase(); }
    const statusVal = blank(status);     if (statusVal !== null) set.status = statusVal;
    const latVal = blank(lat);           if (latVal !== null) set.lat = latVal;
    const lngVal = blank(lng);           if (lngVal !== null) set.lng = lngVal;
    const mnVal = blank(medical_notes);  if (mnVal !== null) set.medical_notes = mnVal;
    const phoneVal = blank(phone);       if (phoneVal !== null) set.phone = phoneVal;
    const pidVal = blank(personal_id);   if (pidVal !== null) set.personal_id = pidVal;
    const didVal = blank(disaster_id);   if (didVal !== null) set.disaster_id = didVal;

    const result = await collection('reports').findOneAndUpdate(
      { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
    );
    const doc = unwrap(result);
    if (!doc) throw new HttpError(404, 'Report not found');
    await auditLog('update', 'reports', req.params.id, actorLabel(req), { name, status });
    res.json({ ok: true, data: mapId(doc) });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = unwrap(await collection('reports').findOneAndDelete(
      { _id: req.params.id }, { projection: { name: 1 } }
    ));
    if (!removed) throw new HttpError(404, 'Report not found');
    await collection('status_history').deleteMany({ report_id: req.params.id }).catch(() => {});
    await auditLog('delete', 'reports', req.params.id, actorLabel(req), { name: removed.name });
    res.json({ ok: true });
  }));

  return router;
};
