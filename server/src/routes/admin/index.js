'use strict';

/**
 * Super-admin REST API  —  /api/admin/*
 *
 * All routes except POST /login require a valid super_admin Bearer token
 * (requireSuperAdmin middleware). Login issues the same opaque-token pair
 * used everywhere else; only the role check distinguishes admin from user.
 *
 * Structure: this file is the orchestrator (IP allowlist, login, stats, audit,
 * and the requireSuperAdmin gate). The per-resource CRUD lives in sibling
 * modules mounted below — users.js / reports.js / disasters.js / links.js /
 * devices.js — sharing helpers from shared.js. (Was one 773-line file.)
 *
 * Security notes
 * ──────────────
 * • Passwords are never stored or returned in plaintext.
 * • personal_id (HKID) is returned UNMASKED here — this endpoint is
 *   super_admin only, audit-logged, and must be restricted to internal
 *   government networks in production (ADMIN_IP_ALLOWLIST).
 * • Every mutating action writes an audit_log row.
 */

const express = require('express');
const { collection } = require('../../db/mongo');
const { requireSuperAdmin, verifyPassword, generateTokenPair } = require('../../lib/authGuard');
const { rateLimit } = require('../../lib/rateLimit');
const { blank, mapId, normPhone, auditLog } = require('./shared');

const adminUsersRouter     = require('./users');
const adminReportsRouter   = require('./reports');
const adminDisastersRouter = require('./disasters');
const adminLinksRouter     = require('./links');
const adminDevicesRouter   = require('./devices');

module.exports = function createAdminRouter() {
  const router = express.Router();

  // M6: code-level network restriction for the admin surface (which returns
  // UNMASKED HKID). When ADMIN_IP_ALLOWLIST is set (comma-separated IPs), any
  // request from outside it is refused — so HKID exposure no longer relies
  // solely on an external network control that might be misconfigured. No-op
  // when unset (local dev).
  router.use((req, res, next) => {
    const raw = (process.env.ADMIN_IP_ALLOWLIST || '').trim();
    if (!raw) return next();
    const allow = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.includes(req.ip)) return next();
    return res.status(403).json({ error: 'Admin access is restricted to allowlisted networks.' });
  });

  // Aggressive rate-limit on the login endpoint to deter brute-force.
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10,
    message: 'Too many admin login attempts — try again in 15 minutes.' });

  // ── POST /api/admin/login ─────────────────────────────────────────
  router.post('/login', loginLimiter, async (req, res) => {
    const { phone, password } = req.body || {};
    if (!phone || !password) {
      return res.status(400).json({ error: 'phone and password are required' });
    }
    try {
      // Normalise the input to the canonical +852XXXXXXXX form so the admin can
      // log in with bare 8 digits OR the full +852 number — matching how citizen
      // login/register already work, and how phones are stored.
      const user = await collection('users').findOne(
        { phone: normPhone(phone), role: 'super_admin' },
        { projection: { phone: 1, name: 1, role: 1, password_hash: 1 } }
      );
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const now = Date.now();
      const tok = generateTokenPair(now);
      await collection('users').updateOne(
        { _id: user._id },
        { $set: {
            access_token_hash: tok.accessTokenHash, access_token_expires_at: tok.accessTokenExpiresAt,
            refresh_token_hash: tok.refreshTokenHash, refresh_token_expires_at: tok.refreshTokenExpiresAt,
            updated_at: now,
        } }
      );

      await auditLog('login', 'users', user._id, `${user.name} (${user.phone})`, null);
      return res.json({
        ok: true,
        user: { id: user._id, phone: user.phone, name: user.name, role: user.role },
        access_token: tok.accessToken,
        refresh_token: tok.refreshToken,
        expires_at: tok.accessTokenExpiresAt,
      });
    } catch (err) {
      console.error('[admin/login]', err);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  // All routes below require super_admin.
  router.use(requireSuperAdmin);

  // ── GET /api/admin/stats ──────────────────────────────────────────
  router.get('/stats', async (req, res) => {
    try {
      const users = collection('users');
      const reports = collection('reports');
      const disasters = collection('disasters');
      const links = collection('account_links');
      const [
        uTotal, uSuper, uCit, uVol, uGov,
        rTotal, rSafe, rInj, rNeed, rMiss,
        dTotal, dActive, lTotal, lConf, lPend, devTotal, audTotal,
      ] = await Promise.all([
        users.countDocuments({}), users.countDocuments({ role: 'super_admin' }),
        users.countDocuments({ role: 'citizen' }), users.countDocuments({ role: 'volunteer' }),
        users.countDocuments({ role: 'government' }),
        reports.countDocuments({}), reports.countDocuments({ status: 'safe' }),
        reports.countDocuments({ status: 'injured' }), reports.countDocuments({ status: 'need_help' }),
        reports.countDocuments({ status: 'missing' }),
        disasters.countDocuments({}), disasters.countDocuments({ active: true }),
        links.countDocuments({}), links.countDocuments({ status: 'confirmed' }),
        links.countDocuments({ status: 'pending' }),
        collection('device_push_tokens').countDocuments({}),
        collection('audit_logs').countDocuments({}),
      ]);
      return res.json({
        ok: true,
        data: {
          users:     { total: uTotal, super_admin: uSuper, citizen: uCit, volunteer: uVol, government: uGov },
          reports:   { total: rTotal, safe: rSafe, injured: rInj, need_help: rNeed, missing: rMiss },
          disasters: { total: dTotal, active: dActive },
          links:     { total: lTotal, confirmed: lConf, pending: lPend },
          devices:   { total: devTotal },
          audits:    { total: audTotal },
        },
      });
    } catch (err) {
      console.error('[admin/stats]', err);
      return res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  // ── Resource CRUD (each its own module) ───────────────────────────
  router.use('/users',     adminUsersRouter());
  router.use('/reports',   adminReportsRouter());
  router.use('/disasters', adminDisastersRouter());
  router.use('/links',     adminLinksRouter());
  router.use('/devices',   adminDevicesRouter());

  // ── GET /api/admin/audit — recent audit trail ─────────────────────
  router.get('/audit', async (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 50, 200);
    const action = blank(req.query.action); // create | update | delete | login
    const entity = blank(req.query.entity); // users | reports | disasters | ...

    const filter = {};
    if (action) filter.action = action;
    if (entity) filter.entity = entity;

    try {
      const docs = await collection('audit_logs')
        .find(filter).sort({ created_at: -1 }).limit(limit).toArray();
      return res.json({ ok: true, data: docs.map(mapId) });
    } catch (err) {
      console.error('[admin/audit GET]', err);
      return res.status(500).json({ error: 'Failed to load audit log' });
    }
  });

  return router;
};
