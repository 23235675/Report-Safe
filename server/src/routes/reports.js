'use strict';

const express = require('express');
const { ReportSchema, RescueQuerySchema, ReportSearchQuerySchema } = require('../lib/zodSchemas');
const { authGuard } = require('../lib/authGuard');
const { collection } = require('../db/mongo');
const reportStore = require('../services/reportStore');
const realtimeService = require('../services/realtimeService');

/**
 * Web is proxy-only (A6): a web report carries no browser location. Resolve the
 * affected person's location from their OWN (non-web) report, falling back to
 * the disaster centre. Returns null if the person has no known location yet.
 */
async function latestNonWebLocation(filter) {
  const r = await collection('reports')
    .find({ ...filter, user_type: { $ne: 'web' } })
    .project({ lat: 1, lng: 1 })
    .sort({ updated_at: -1 })
    .limit(1)
    .toArray();
  return r.length ? { lat: r[0].lat, lng: r[0].lng } : null;
}

async function resolveProxyLocation(data) {
  if (data.personal_id) {
    const loc = await latestNonWebLocation({ personal_id: data.personal_id });
    if (loc) return loc;
  }
  if (data.phone) {
    const loc = await latestNonWebLocation({ phone: data.phone });
    if (loc) return loc;
  }
  if (data.disaster_id) {
    const d = await collection('disasters').findOne({ _id: data.disaster_id }, { projection: { lat: 1, lng: 1 } });
    if (d) return { lat: d.lat, lng: d.lng };
  }
  return null;
}

/** Resolve the affected person's user id from HKID then phone, for identity linking. */
async function resolveReportedForUser(data) {
  if (data.reported_for_user_id) return data.reported_for_user_id;
  if (data.personal_id) {
    const u = await collection('users').findOne({ personal_id: data.personal_id }, { projection: { _id: 1 } });
    if (u) return u._id;
  }
  if (data.phone) {
    const u = await collection('users').findOne({ phone: data.phone }, { projection: { _id: 1 } });
    if (u) return u._id;
  }
  return null;
}

/**
 * Build the /api/reports router.
 * @param {import('socket.io').Server} io Socket.IO instance for live broadcasts.
 * @returns {import('express').Router}
 */
module.exports = function createReportsRouter(io) {
  const router = express.Router();

  // POST /api/reports — submit (or relay) a status report.
  router.post('/', async (req, res) => {
    try {
      const parsed = ReportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.errors });
      }

      const data = parsed.data;
      if (data.user_type === 'web') {
        // Web proxy reporters cannot mark someone as "safe" — only the affected
        // person can confirm their own safety, and they do so via the mobile app.
        if (data.status === 'safe') {
          return res.status(422).json({
            error: 'Web proxy reports cannot use status "safe". The affected person must confirm their own safety via the mobile app.',
          });
        }
        // Proxy report (A6): force family attribution, identity-link to the
        // affected person, and never trust a browser-supplied location.
        data.reported_by = 'family';
        data.reported_for_user_id = await resolveReportedForUser(data);
        if (data.lat == null || data.lng == null) {
          const loc = await resolveProxyLocation(data);
          if (!loc) {
            return res.status(422).json({
              error: 'No known location for the affected person yet — they need to share their status from the mobile app, or include a disaster_id.',
            });
          }
          data.lat = loc.lat;
          data.lng = loc.lng;
        }
      } else if (data.lat == null || data.lng == null) {
        return res.status(400).json({ error: 'lat and lng are required.' });
      }

      // Invariant #1 (never lose a report): the old schema's FK on disaster_id
      // would reject an unknown id, so the route stored the report unlinked.
      // MongoDB has no FK to violate, so we proactively null an unknown
      // disaster_id to preserve that exact outcome (a clean, unlinked report).
      if (data.disaster_id) {
        const known = await collection('disasters').findOne({ _id: data.disaster_id }, { projection: { _id: 1 } });
        if (!known) {
          console.warn(`[routes/reports POST /] unknown disaster_id "${data.disaster_id}" — storing report unlinked`);
          data.disaster_id = null;
        }
      }
      const result = await reportStore.upsertReport(parsed.data);

      // Web proxy reports are excluded from public stats (getStats excludeWeb=true)
      // and must never trigger disaster alerts — only mobile reports count toward
      // affected-person totals and realtime broadcasts.
      if (data.user_type !== 'web') {
        await realtimeService.broadcastStats(io);
      }

      return res.status(201).json({ ok: true, id: result.id });
    } catch (err) {
      console.error('[routes/reports POST /] failed to store report:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/reports/search?q=&limit=&offset= — public name search (coarse location only).
  router.get('/search', async (req, res) => {
    try {
      const parsed = ReportSearchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
      }
      const { q, limit, offset } = parsed.data;
      const results = await reportStore.searchByName(q, { limit, offset });
      return res.json({ ok: true, results, limit, offset });
    } catch (err) {
      console.error('[routes/reports GET /search] failed to search:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/reports/rescue?lat=&lng=&radius= — privileged triage view.
  router.get('/rescue', authGuard, async (req, res) => {
    try {
      const parsed = RescueQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.errors });
      }
      const { lat, lng, radius, limit, offset } = parsed.data;
      const results = await reportStore.getRescueView(lat, lng, radius, { limit, offset });
      return res.json({ ok: true, results, limit, offset });
    } catch (err) {
      console.error('[routes/reports GET /rescue] failed to build rescue view:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/reports/stats — aggregate counts; ?exclude_web=true omits web-user reports.
  router.get('/stats', async (req, res) => {
    try {
      const excludeWeb = req.query.exclude_web === 'true';
      const stats = await reportStore.getStats({ excludeWeb });
      return res.json({ ok: true, stats });
    } catch (err) {
      console.error('[routes/reports GET /stats] failed to get stats:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
