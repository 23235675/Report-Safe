'use strict';

const express = require('express');
const { allowGovOrVolunteer } = require('../lib/authGuard');
const { logAudit } = require('../lib/audit');
const { ShelterQuerySchema, ShelterCreateSchema, ShelterUpdateSchema } = require('../lib/zodSchemas');
const { validate, asyncHandler } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');
const shelterStore = require('../services/shelterStore');

module.exports = function createSheltersRouter() {
  const router = express.Router();

  // GET /api/shelters — list shelters; optionally by location radius / disaster / source.
  router.get('/', validate(ShelterQuerySchema, 'query'), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await shelterStore.list(req.valid) });
  }));

  // GET /api/shelters/:id — single shelter detail.
  router.get('/:id', asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await shelterStore.get(req.params.id) });
  }));

  // POST /api/shelters — create shelter (gov token OR volunteer/government user).
  router.post('/', allowGovOrVolunteer, validate(ShelterCreateSchema), asyncHandler(async (req, res) => {
    const data = await shelterStore.create(req.valid);
    logAudit({ action: 'shelter.create', entity: 'shelters', entityId: data.id, details: { name: data.name, type: data.type, source: data.source } });
    res.status(201).json({ ok: true, data });
  }));

  // PUT /api/shelters/:id — update shelter (gov token OR volunteer/government user).
  router.put('/:id', allowGovOrVolunteer, validate(ShelterUpdateSchema), asyncHandler(async (req, res) => {
    const data = await shelterStore.update(req.params.id, req.valid);
    logAudit({ action: 'shelter.update', entity: 'shelters', entityId: req.params.id, details: req.valid });
    res.json({ ok: true, data });
  }));

  // DELETE /api/shelters/:id — soft-delete (gov token OR volunteer/government user).
  router.delete('/:id', allowGovOrVolunteer, asyncHandler(async (req, res) => {
    await shelterStore.deactivate(req.params.id);
    logAudit({ action: 'shelter.deactivate', entity: 'shelters', entityId: req.params.id });
    res.json({ ok: true });
  }));

  // Router-scoped error handler; the app-level one in index.js is the backstop.
  router.use(errorHandler);

  return router;
};
