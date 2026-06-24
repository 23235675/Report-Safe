'use strict';

const express = require('express');
const { ManualDisasterSchema } = require('../lib/zodSchemas');
const { authGuard } = require('../lib/authGuard');
const { logAudit }  = require('../lib/audit');
const { collection } = require('../db/mongo');
const triggerEngine = require('../services/triggerEngine');
const realtimeService = require('../services/realtimeService');
const { mapId, unwrap } = require('../lib/mongoMap');

module.exports = function createDisastersRouter(io) {
  const router = express.Router();

  // GET /api/disasters — all currently active disasters.
  router.get('/', async (req, res) => {
    try {
      const docs = await collection('disasters')
        .find({ active: true })
        .sort({ started_at: -1 })
        .toArray();
      return res.json({ ok: true, data: docs.map(mapId) });
    } catch (err) {
      console.error('[routes/disasters GET /] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/disasters/trigger — manual webhook (privileged).
  router.post('/trigger', authGuard, async (req, res) => {
    try {
      const parsed = ManualDisasterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.errors });
      }

      const disaster = await triggerEngine.triggerManual(parsed.data, io);
      if (!disaster) {
        return res.status(200).json({
          ok: true,
          disaster: null,
          message: 'Suppressed — an active disaster already covers this area.',
        });
      }
      logAudit({ action: 'disaster.trigger', entity: 'disasters', entityId: disaster.id, details: parsed.data });
      return res.status(201).json({ ok: true, data: disaster });
    } catch (err) {
      console.error('[routes/disasters POST /trigger] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/disasters/:id/deactivate — end an active disaster (B20, gov-only).
  // The only lifecycle endpoint outside the admin panel; sets active=false +
  // ended_at, broadcasts the deactivation, and audit-logs the action. Once
  // inactive, the partial-unique (type,active) index frees the type to be
  // re-triggered (M4).
  router.post('/:id/deactivate', authGuard, async (req, res) => {
    try {
      const result = await collection('disasters').findOneAndUpdate(
        { _id: req.params.id, active: true },
        { $set: { active: false, ended_at: Date.now() } },
        { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'No active disaster with that id.' });

      realtimeService.broadcastDisasterDeactivated(io, req.params.id);
      logAudit({ action: 'disaster.deactivate', entity: 'disasters', entityId: req.params.id });
      return res.json({ ok: true, data: mapId(doc) });
    } catch (err) {
      console.error('[routes/disasters POST /:id/deactivate] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
