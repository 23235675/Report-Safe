'use strict';

const express = require('express');
const { ManualDisasterSchema } = require('../lib/zodSchemas');
const { authGuard } = require('../lib/authGuard');
const { logAudit } = require('../lib/audit');
const { validate, asyncHandler } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');
const triggerEngine = require('../services/triggerEngine');
const realtimeService = require('../services/realtimeService');
const disasterStore = require('../services/disasterStore');

module.exports = function createDisastersRouter(io) {
  const router = express.Router();

  // GET /api/disasters — all currently active disasters.
  router.get('/', asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await disasterStore.listActive() });
  }));

  // POST /api/disasters/trigger — manual webhook (privileged). Duplicate
  // active disasters (same type within 30 km) are suppressed, not errors.
  router.post('/trigger', authGuard, validate(ManualDisasterSchema), asyncHandler(async (req, res) => {
    const disaster = await triggerEngine.triggerManual(req.valid, io);
    if (!disaster) {
      return res.status(200).json({
        ok: true,
        disaster: null,
        message: 'Suppressed — an active disaster already covers this area.',
      });
    }
    logAudit({ action: 'disaster.trigger', entity: 'disasters', entityId: disaster.id, details: req.valid });
    res.status(201).json({ ok: true, data: disaster });
  }));

  // POST /api/disasters/:id/deactivate — end an active disaster (gov-only).
  router.post('/:id/deactivate', authGuard, asyncHandler(async (req, res) => {
    const data = await disasterStore.deactivate(req.params.id);
    realtimeService.broadcastDisasterDeactivated(io, req.params.id);
    logAudit({ action: 'disaster.deactivate', entity: 'disasters', entityId: req.params.id });
    res.json({ ok: true, data });
  }));

  // Router-scoped error handler; the app-level one in index.js is the backstop.
  router.use(errorHandler);

  return router;
};
