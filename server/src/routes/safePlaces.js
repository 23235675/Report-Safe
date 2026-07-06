'use strict';

const express = require('express');
const { authenticate, allowGovOrVolunteer } = require('../lib/authGuard');
const { SafePlaceCreateSchema, SafePlaceQuerySchema } = require('../lib/zodSchemas');
const { validate, asyncHandler, HttpError } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');
const safePlaceStore = require('../services/safePlaceStore');

module.exports = function createSafePlacesRouter() {
  const router = express.Router();

  // GET /api/safe-places — approved active places, optionally within a radius.
  router.get('/', validate(SafePlaceQuerySchema, 'query'), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await safePlaceStore.listApproved(req.valid) });
  }));

  // POST /api/safe-places — an authenticated USER submits a refuge location
  // (the gov token is a console, not a submitter).
  router.post('/', authenticate, validate(SafePlaceCreateSchema), asyncHandler(async (req, res) => {
    if (req.auth.kind !== 'user') {
      throw new HttpError(403, 'A user account is required to submit a safe place.');
    }
    res.status(201).json({ ok: true, data: await safePlaceStore.submit(req.auth.userId, req.valid) });
  }));

  // GET /api/safe-places/pending — moderation queue (gov/volunteer only).
  router.get('/pending', allowGovOrVolunteer, asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await safePlaceStore.pendingQueue() });
  }));

  // PUT /api/safe-places/:id/status — approve or decline (gov/volunteer only).
  router.put('/:id/status', allowGovOrVolunteer, asyncHandler(async (req, res) => {
    const status = req.body?.status;
    if (status !== 'approved' && status !== 'rejected') {
      throw new HttpError(400, "status must be 'approved' or 'rejected'");
    }
    const reviewer = req.auth?.user ? `${req.auth.user.name} (${req.auth.user.phone})` : 'gov';
    res.json({ ok: true, data: await safePlaceStore.review(req.params.id, status, reviewer) });
  }));

  // Router-scoped error handler; the app-level one in index.js is the backstop.
  router.use(errorHandler);

  return router;
};
