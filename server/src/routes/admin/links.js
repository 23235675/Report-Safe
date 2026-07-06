'use strict';

const express = require('express');
const { collection } = require('../../db/mongo');
const { ilike, unwrap } = require('../../lib/mongoMap');
const { HttpError, asyncHandler, validate } = require('../../lib/http');
const { AdminLinkUpdateSchema } = require('../../lib/zodSchemas');
const { blank, mapId, auditLog, actorLabel } = require('./shared');

// Mounted at /api/admin/links by index.js (after requireSuperAdmin).
module.exports = function adminLinksRouter() {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const cursorMode = req.query.after !== undefined; // M7: ?after present → cursor mode
    const after  = blank(req.query.after);
    const status = blank(req.query.status);

    const filter = {};
    if (status) filter.status = status;
    if (req.query.q) {
      // Search matches name/phone of EITHER party → resolve matching user ids first.
      const rx = ilike(req.query.q);
      const matched = await collection('users').find({ $or: [{ name: rx }, { phone: rx }] }).project({ _id: 1 }).toArray();
      const ids = matched.map((u) => u._id);
      filter.$or = [{ user_a_id: { $in: ids } }, { user_b_id: { $in: ids } }];
    }

    const [total, links] = await Promise.all([
      collection('account_links').countDocuments(filter),
      cursorMode
        ? collection('account_links').find(after ? { ...filter, _id: { $gt: after } } : filter).sort({ _id: 1 }).limit(limit).toArray()
        : collection('account_links').find(filter).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
    ]);
    const next_cursor = links.length === limit ? links[links.length - 1]._id : null;

    const allIds = [...new Set(links.flatMap((l) => [l.user_a_id, l.user_b_id]).filter(Boolean))];
    const users = allIds.length
      ? await collection('users').find({ _id: { $in: allIds } }).project({ _id: 1, name: 1, phone: 1 }).toArray()
      : [];
    const byId = new Map(users.map((u) => [u._id, u]));

    const rows = [];
    for (const l of links) {
      const ua = byId.get(l.user_a_id), ub = byId.get(l.user_b_id);
      if (!ua || !ub) continue; // INNER JOIN drops a link missing either party
      rows.push({
        id: l._id, status: l.status, confirmed_at: l.confirmed_at ?? null, created_at: l.created_at,
        user_a_id: l.user_a_id, user_a_name: ua.name, user_a_phone: ua.phone,
        user_b_id: l.user_b_id, user_b_name: ub.name, user_b_phone: ub.phone,
      });
    }
    res.json({ ok: true, data: rows, meta: { total, next_cursor } });
  }));

  router.put('/:id', validate(AdminLinkUpdateSchema), asyncHandler(async (req, res) => {
    const { status } = req.valid;
    const allowed = ['pending', 'confirmed', 'blocked'];
    if (!status || !allowed.includes(status)) {
      throw new HttpError(400, `status must be one of: ${allowed.join(', ')}`);
    }
    const set = { status };
    if (status === 'confirmed') set.confirmed_at = Date.now(); // else keep existing
    const result = await collection('account_links').findOneAndUpdate(
      { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
    );
    const doc = unwrap(result);
    if (!doc) throw new HttpError(404, 'Link not found');
    await auditLog('update', 'account_links', req.params.id, actorLabel(req), { status });
    res.json({ ok: true, data: mapId(doc) });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = unwrap(await collection('account_links').findOneAndDelete({ _id: req.params.id }, { projection: { _id: 1 } }));
    if (!removed) throw new HttpError(404, 'Link not found');
    await auditLog('delete', 'account_links', req.params.id, actorLabel(req), null);
    res.json({ ok: true });
  }));

  return router;
};
