'use strict';

const express = require('express');
const { allowGovOrVolunteer } = require('../lib/authGuard');
const { MissingPersonCreateSchema, MissingPersonUpdateSchema } = require('../lib/zodSchemas');
const { logAudit } = require('../lib/audit');
const { validate, asyncHandler } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');
const realtimeService = require('../services/realtimeService');
const missingPersonStore = require('../services/missingPersonStore');

/**
 * Missing-person case management. All writes require a gov or volunteer
 * principal; citizens cannot open or change cases.
 */
module.exports = function createMissingPersonsRouter(io) {
  const router = express.Router();

  // GET /api/missing-persons?status= — list cases (default: open ones).
  router.get('/', allowGovOrVolunteer, asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await missingPersonStore.list(req.query.status) });
  }));

  // POST /api/missing-persons — open a case (optionally linked to a report).
  router.post('/', allowGovOrVolunteer, validate(MissingPersonCreateSchema), asyncHandler(async (req, res) => {
    const openedBy = req.auth.kind === 'gov' ? 'gov-token' : req.auth.userId;
    const data = await missingPersonStore.open(req.valid, openedBy);
    realtimeService.broadcastMissingAlert(io, [data.id]);
    logAudit({ action: 'missing_person.open', entity: 'missing_person_cases', entityId: data.id, details: { report_id: data.report_id } });
    res.status(201).json({ ok: true, data });
  }));

  // PUT /api/missing-persons/:id — update status / notes.
  router.put('/:id', allowGovOrVolunteer, validate(MissingPersonUpdateSchema), asyncHandler(async (req, res) => {
    const { data, set } = await missingPersonStore.update(req.params.id, req.valid);
    logAudit({ action: 'missing_person.update', entity: 'missing_person_cases', entityId: req.params.id, details: set });
    res.json({ ok: true, data });
  }));

  // DELETE /api/missing-persons/:id — close/archive (soft: case_status='closed').
  router.delete('/:id', allowGovOrVolunteer, asyncHandler(async (req, res) => {
    await missingPersonStore.close(req.params.id);
    logAudit({ action: 'missing_person.close', entity: 'missing_person_cases', entityId: req.params.id });
    res.json({ ok: true });
  }));

  // Router-scoped error handler; the app-level one in index.js is the backstop.
  router.use(errorHandler);

  return router;
};
