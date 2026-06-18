'use strict';

const express = require('express');
const { ManualDisasterSchema } = require('../lib/zodSchemas');
const { authGuard } = require('../lib/authGuard');
const { logAudit }  = require('../lib/audit');
const { collection } = require('../db/mongo');
const triggerEngine = require('../services/triggerEngine');

/** Map a stored doc's _id → id. */
function mapId(doc) {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

module.exports = function createDisastersRouter(io) {
  const router = express.Router();

  // GET /api/disasters — all currently active disasters.
  router.get('/', async (req, res) => {
    try {
      const docs = await collection('disasters')
        .find({ active: true })
        .sort({ started_at: -1 })
        .toArray();
      return res.json({ ok: true, disasters: docs.map(mapId) });
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
      return res.status(201).json({ ok: true, disaster });
    } catch (err) {
      console.error('[routes/disasters POST /trigger] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
