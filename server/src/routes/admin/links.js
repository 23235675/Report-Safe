'use strict';

const express = require('express');
const { collection } = require('../../db/mongo');
const { ilike, unwrap } = require('../../lib/mongoMap');
const { blank, mapId, auditLog, actorLabel } = require('./shared');

// Mounted at /api/admin/links by index.js (after requireSuperAdmin).
module.exports = function adminLinksRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const cursorMode = req.query.after !== undefined; // M7: ?after present → cursor mode
    const after  = blank(req.query.after);
    const status = blank(req.query.status);

    try {
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
      return res.json({ ok: true, data: rows, meta: { total, next_cursor } });
    } catch (err) {
      console.error('[admin/links GET]', err);
      return res.status(500).json({ error: 'Failed to list links' });
    }
  });

  router.put('/:id', async (req, res) => {
    const { status } = req.body || {};
    const allowed = ['pending', 'confirmed', 'blocked'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }
    try {
      const set = { status };
      if (status === 'confirmed') set.confirmed_at = Date.now(); // else keep existing
      const result = await collection('account_links').findOneAndUpdate(
        { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Link not found' });
      await auditLog('update', 'account_links', req.params.id, actorLabel(req), { status });
      return res.json({ ok: true, data: mapId(doc) });
    } catch (err) {
      console.error('[admin/links PUT]', err);
      return res.status(500).json({ error: 'Failed to update link' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const removed = unwrap(await collection('account_links').findOneAndDelete({ _id: req.params.id }, { projection: { _id: 1 } }));
      if (!removed) return res.status(404).json({ error: 'Link not found' });
      await auditLog('delete', 'account_links', req.params.id, actorLabel(req), null);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[admin/links DELETE]', err);
      return res.status(500).json({ error: 'Failed to delete link' });
    }
  });

  return router;
};
