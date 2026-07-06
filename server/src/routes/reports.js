'use strict';

const express = require('express');
const { ReportSchema, RescueQuerySchema, ReportSearchQuerySchema } = require('../lib/zodSchemas');
const { authGuard, authenticate } = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');
const { validate, asyncHandler } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');
const reportStore = require('../services/reportStore');
const reportPolicy = require('../services/reportPolicy');
const realtimeService = require('../services/realtimeService');

/**
 * /api/reports — report ingest + the read views built on reports.
 * Handlers parse, authorize and delegate; the ingest rulebook lives in
 * services/reportPolicy, storage in services/reportStore.
 * @param {import('socket.io').Server} io Socket.IO instance for live broadcasts.
 * @returns {import('express').Router}
 */
module.exports = function createReportsRouter(io) {
  const router = express.Router();

  // Ingest limiter: separate from the global /api limiter and keyed by USER
  // (post-auth), not raw IP — carrier-NAT users sharing an egress IP must not
  // throttle each other during a real surge.
  const ingestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.REPORT_RATE_LIMIT_PER_MIN) || 600,
    keyFn: (req) => req.auth?.userId || `gov:${req.ip}`,
    message: 'Report ingest rate limit reached — your queued reports will retry automatically.',
  });

  // POST /api/reports — submit (or idempotently relay) a status report.
  // Identity is derived from the principal, never trusted from the body.
  router.post('/', authenticate, ingestLimiter, validate(ReportSchema),
    asyncHandler(async (req, res) => {
      const r = await reportPolicy.prepareForStorage(req.valid, req.auth);
      const { id } = await reportStore.upsertReport(r);

      // Web proxy reports never move official stats or trigger broadcasts.
      if (r.user_type !== 'web') await realtimeService.broadcastStats(io);

      res.status(201).json({ ok: true, data: { id } });
    }));

  // GET /api/reports/search?q=&limit=&offset= — public name/phone search
  // (coarse location + masked phone only).
  router.get('/search', validate(ReportSearchQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { q, limit, offset } = req.valid;
      const data = await reportStore.searchByName(q, { limit, offset });
      res.json({ ok: true, data, meta: { limit, offset } });
    }));

  // GET /api/reports/people?limit=&offset=&status= — public Status Overview
  // roster; optional `status` filters to one bucket.
  router.get('/people', asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const status = req.query.status || undefined;
    const { rows, total } = await reportStore.listPeople({ limit, offset, status });
    res.json({ ok: true, data: rows, meta: { limit, offset, total, status } });
  }));

  // GET /api/reports/rescue?lat=&lng=&radius= — privileged triage view.
  router.get('/rescue', authGuard, validate(RescueQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { lat, lng, radius, limit, offset } = req.valid;
      const data = await reportStore.getRescueView(lat, lng, radius, { limit, offset });
      res.json({ ok: true, data, meta: { limit, offset } });
    }));

  // GET /api/reports/stats — official counts exclude web (proxy) reporters by
  // default so this REST path agrees with the socket stats_update broadcast.
  router.get('/stats', asyncHandler(async (req, res) => {
    const excludeWeb = req.query.exclude_web !== 'false';
    res.json({ ok: true, data: await reportStore.getStats({ excludeWeb }) });
  }));

  // Router-scoped error handler: thrown HttpErrors resolve to their JSON body
  // even when this router is mounted standalone (tests, embedding). The
  // app-level errorHandler in index.js remains the backstop.
  router.use(errorHandler);

  return router;
};
