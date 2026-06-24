'use strict';

const express = require('express');
const { collection } = require('../../db/mongo');
const { unwrap } = require('../../lib/mongoMap');
const { blank, auditLog, actorLabel } = require('./shared');

// Mounted at /api/admin/devices by index.js (after requireSuperAdmin).
module.exports = function adminDevicesRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    const platform = blank(req.query.platform);
    const located  = req.query.located; // 'true' | 'false' | undefined
    const linked   = req.query.linked;  // 'true' | 'false' | undefined

    const filter = {};
    if (platform) filter.platform = platform;
    if (located === 'true')  { filter.lat = { $ne: null }; filter.lng = { $ne: null }; }
    if (located === 'false') filter.$or = [{ lat: null }, { lng: null }];
    if (linked === 'true')   filter.user_id = { $ne: null };
    if (linked === 'false')  filter.user_id = null;

    try {
      // Push-targetable devices (those with a GPS fix) lead.
      const [page, total] = await Promise.all([
        collection('device_push_tokens').aggregate([
          { $match: filter },
          { $addFields: { _located: { $cond: [{ $and: [{ $ne: ['$lat', null] }, { $ne: ['$lng', null] }] }, 1, 0] } } },
          { $sort: { _located: -1, updated_at: -1 } },
          { $skip: offset },
          { $limit: limit },
        ]).toArray(),
        collection('device_push_tokens').countDocuments(filter),
      ]);

      const userIds = [...new Set(page.map((d) => d.user_id).filter(Boolean))];
      const users = userIds.length
        ? await collection('users').find({ _id: { $in: userIds } }).project({ _id: 1, name: 1, phone: 1 }).toArray()
        : [];
      const byId = new Map(users.map((u) => [u._id, u]));

      const rows = page.map((d) => {
        const u = d.user_id ? byId.get(d.user_id) : null;
        return {
          id: d._id, token: d.token, platform: d.platform, lat: d.lat, lng: d.lng,
          created_at: d.created_at, updated_at: d.updated_at, user_id: d.user_id ?? null,
          user_name: u ? u.name : null, user_phone: u ? u.phone : null,
        };
      });
      return res.json({ ok: true, data: rows, meta: { total } });
    } catch (err) {
      console.error('[admin/devices GET]', err);
      return res.status(500).json({ error: 'Failed to list devices' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const removed = unwrap(await collection('device_push_tokens').findOneAndDelete(
        { _id: req.params.id }, { projection: { token: 1 } }
      ));
      if (!removed) return res.status(404).json({ error: 'Device not found' });
      await auditLog('delete', 'device_push_tokens', req.params.id, actorLabel(req),
        { token: removed.token?.slice(0, 16) + '…' });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[admin/devices DELETE]', err);
      return res.status(500).json({ error: 'Failed to delete device' });
    }
  });

  return router;
};
