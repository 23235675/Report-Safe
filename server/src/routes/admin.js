'use strict';

/**
 * Super-admin REST API  —  /api/admin/*
 *
 * All routes except POST /login require a valid super_admin Bearer token
 * (requireSuperAdmin middleware). Login issues the same opaque-token pair
 * used everywhere else; only the role check distinguishes admin from user.
 *
 * Security notes
 * ──────────────
 * • Passwords are never stored or returned in plaintext.
 * • personal_id (HKID) is returned UNMASKED here — this endpoint is
 *   super_admin only, audit-logged, and must be restricted to internal
 *   government networks in production.
 * • Every mutating action writes an audit_log row.
 */

const express = require('express');
const crypto  = require('crypto');
const { collection } = require('../db/mongo');
const {
  requireSuperAdmin, hashPassword, verifyPassword,
  generateTokenPair, hashToken,
} = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Normalise a value for COALESCE-style "update only if provided" semantics:
 * undefined, null, and EMPTY STRING all become null (so the field keeps its
 * existing value). Without this, the web admin form — which always submits
 * every field, including empty selects like role="" — would overwrite a column
 * with an empty string.
 */
const blank = (v) => (v === undefined || v === null || v === '' ? null : v);

// Allowed values for the former CHECK-constrained columns. Validating here turns
// a bad value into a clean 400 instead of letting an invalid status/role land in
// the database.
const VALID_ROLES        = ['citizen', 'volunteer', 'government', 'super_admin'];
const VALID_USER_TYPES   = ['mobile', 'web'];
const VALID_REPORT_STATUS = [
  'safe', 'injured', 'need_help', 'awaiting_response', 'potentially_missing',
  'missing', 'verified_missing', 'rescued', 'deceased',
];

/** Escape a string for safe use inside a MongoDB $regex. */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Case-insensitive substring match (the former SQL ILIKE '%q%'). */
function ilike(q) {
  return new RegExp(escapeRegex(q), 'i');
}
/** Map a stored doc's _id → id and drop the search-helper field. */
function mapId(doc) {
  if (!doc) return doc;
  const { _id, name_lower, ...rest } = doc;
  return { id: _id, ...rest };
}
/** Driver v6 findOneAnd* returns the doc directly; v5 wrapped it in {value}. */
function unwrap(res) {
  return res && res.value !== undefined ? res.value : res;
}

/** Normalise a HK phone: keep last 8 digits, prefix +852. Null-safe. */
function normPhone(v) {
  if (blank(v) === null) return null;
  const digits = String(v).replace(/\D/g, '');
  return `+852${digits.slice(-8)}`;
}

/**
 * Emulate the FK side-effects of deleting a user (the SQL schema declared
 * ON DELETE CASCADE / SET NULL). MongoDB has no FKs, so we do it explicitly.
 */
async function cascadeUserRemoval(userId) {
  await collection('account_links').deleteMany({ $or: [{ user_a_id: userId }, { user_b_id: userId }] });
  await collection('device_push_tokens').deleteMany({ user_id: userId });
  await collection('safe_places').deleteMany({ created_by_user_id: userId });
  await collection('reports').updateMany({ user_id: userId }, { $set: { user_id: null } });
  await collection('reports').updateMany({ reported_for_user_id: userId }, { $set: { reported_for_user_id: null } });
  await collection('shelters').updateMany({ created_by_user_id: userId }, { $set: { created_by_user_id: null } });
}

async function auditLog(action, entity, entityId, actor, details) {
  try {
    await collection('audit_logs').insertOne({
      _id: crypto.randomUUID(), action, entity, entity_id: entityId, actor,
      details: details ? JSON.stringify(details) : null, created_at: Date.now(),
    });
  } catch (e) {
    console.error('[admin] audit log failed:', e.message);
  }
}

function actorLabel(req) {
  return req.admin ? `${req.admin.name} (${req.admin.phone})` : 'super_admin';
}

// ── Router factory ───────────────────────────────────────────────────

module.exports = function createAdminRouter() {
  const router = express.Router();

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
      const user = await collection('users').findOne(
        { phone, role: 'super_admin' },
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
        users:     { total: uTotal, super_admin: uSuper, citizen: uCit, volunteer: uVol, government: uGov },
        reports:   { total: rTotal, safe: rSafe, injured: rInj, need_help: rNeed, missing: rMiss },
        disasters: { total: dTotal, active: dActive },
        links:     { total: lTotal, confirmed: lConf, pending: lPend },
        devices:   { total: devTotal },
        audits:    { total: audTotal },
      });
    } catch (err) {
      console.error('[admin/stats]', err);
      return res.status(500).json({ error: 'Failed to load stats' });
    }
  });

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  USERS                                                         ║
  // ╚════════════════════════════════════════════════════════════════╝

  router.get('/users', async (req, res) => {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const role     = blank(req.query.role);
    const userType = blank(req.query.user_type);
    const consent  = req.query.consent;    // 'true' | 'false' | undefined
    const hasEmail = req.query.has_email;  // 'true' | 'false' | undefined

    const filter = {};
    const and = [];
    if (req.query.q) {
      const rx = ilike(req.query.q);
      and.push({ $or: [{ name: rx }, { phone: rx }, { email: rx }] });
    }
    if (role)     filter.role = role;
    if (userType) filter.user_type = userType;
    if (consent === 'true' || consent === 'false') filter.privacy_consent = (consent === 'true');
    if (hasEmail === 'true')  and.push({ email: { $nin: [null, ''] } });
    if (hasEmail === 'false') and.push({ $or: [{ email: null }, { email: '' }] });
    if (and.length) filter.$and = and;

    try {
      const rows = await collection('users')
        .find(filter)
        .project({ phone: 1, name: 1, email: 1, personal_id: 1, role: 1, user_type: 1, privacy_consent: 1, created_at: 1, updated_at: 1 })
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray();
      const total = await collection('users').countDocuments(filter);
      return res.json({ rows: rows.map(mapId), total });
    } catch (err) {
      console.error('[admin/users GET]', err);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  });

  router.post('/users', async (req, res) => {
    const {
      phone, name, email, personal_id, role = 'citizen',
      user_type = 'mobile', privacy_consent = false, password,
    } = req.body || {};
    if (!phone || !name) return res.status(400).json({ error: 'phone and name are required' });
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (!VALID_USER_TYPES.includes(user_type)) {
      return res.status(400).json({ error: `user_type must be one of: ${VALID_USER_TYPES.join(', ')}` });
    }
    if (role === 'super_admin' && !password) {
      return res.status(400).json({ error: 'password is required for super_admin accounts' });
    }
    try {
      const id  = crypto.randomUUID();
      const now = Date.now();
      const tok = generateTokenPair(now);
      const pwHash = password ? hashPassword(password) : null;
      const pid = blank(personal_id);
      const doc = {
        _id: id, phone: normPhone(phone), name, email: blank(email), role, user_type,
        privacy_consent, password_hash: pwHash,
        access_token_hash: tok.accessTokenHash, access_token_expires_at: tok.accessTokenExpiresAt,
        refresh_token_hash: tok.refreshTokenHash, refresh_token_expires_at: tok.refreshTokenExpiresAt,
        created_at: now, updated_at: now,
      };
      // personal_id is OMITTED when absent so the sparse-unique index skips it
      // (storing null would collide with every other HKID-less account).
      if (pid !== null) doc.personal_id = pid;

      await collection('users').insertOne(doc);
      await auditLog('create', 'users', id, actorLabel(req), { phone, name, role });
      return res.status(201).json({
        ok: true,
        user: { id, phone: doc.phone, name, email: doc.email, personal_id: pid, role, user_type, privacy_consent, created_at: now },
      });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'Phone number already registered' });
      console.error('[admin/users POST]', err);
      return res.status(500).json({ error: 'Failed to create user' });
    }
  });

  router.put('/users/:id', async (req, res) => {
    const {
      phone, name, email, personal_id, role, user_type, privacy_consent, password,
    } = req.body || {};

    // Validate the former CHECK values up front → clean 400 instead of a bad write.
    if (blank(role) && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (blank(user_type) && !VALID_USER_TYPES.includes(user_type)) {
      return res.status(400).json({ error: `user_type must be one of: ${VALID_USER_TYPES.join(', ')}` });
    }

    // Lockout guard: an admin must not demote their OWN super_admin role.
    if (req.params.id === req.admin.id && blank(role) && role !== 'super_admin') {
      return res.status(400).json({ error: 'You cannot change your own super_admin role.' });
    }

    try {
      // Passwordless-admin guard: promoting to super_admin without a password
      // makes an account that can never log in. Require one unless it has one.
      if (role === 'super_admin' && !password) {
        const existing = await collection('users').findOne({ _id: req.params.id }, { projection: { password_hash: 1 } });
        if (!existing || !existing.password_hash) {
          return res.status(400).json({ error: 'password is required when promoting an account to super_admin' });
        }
      }

      // COALESCE($x, col): only overwrite fields actually provided (blank→skip).
      const set = { updated_at: Date.now() };
      const phoneVal = normPhone(phone); if (phoneVal !== null) set.phone = phoneVal;
      const nameVal  = blank(name);       if (nameVal !== null) set.name = nameVal;
      const emailVal = blank(email);      if (emailVal !== null) set.email = emailVal;
      const pidVal   = blank(personal_id); if (pidVal !== null) set.personal_id = pidVal;
      const roleVal  = blank(role);       if (roleVal !== null) set.role = roleVal;
      const utVal    = blank(user_type);  if (utVal !== null) set.user_type = utVal;
      if (privacy_consent !== undefined && privacy_consent !== null) set.privacy_consent = privacy_consent;
      if (password) set.password_hash = hashPassword(password);

      const result = await collection('users').findOneAndUpdate(
        { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'User not found' });
      await auditLog('update', 'users', req.params.id, actorLabel(req), { phone, name, role });
      return res.json({
        ok: true,
        user: {
          id: doc._id, phone: doc.phone, name: doc.name, email: doc.email ?? null,
          personal_id: doc.personal_id ?? null, role: doc.role, user_type: doc.user_type,
          privacy_consent: doc.privacy_consent, updated_at: doc.updated_at,
        },
      });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'Phone number already in use' });
      console.error('[admin/users PUT]', err);
      return res.status(500).json({ error: 'Failed to update user' });
    }
  });

  router.delete('/users/:id', async (req, res) => {
    if (req.params.id === req.admin.id) {
      return res.status(400).json({ error: 'Cannot delete your own admin account' });
    }
    try {
      const removed = unwrap(await collection('users').findOneAndDelete(
        { _id: req.params.id }, { projection: { name: 1, phone: 1 } }
      ));
      if (!removed) return res.status(404).json({ error: 'User not found' });
      await cascadeUserRemoval(req.params.id); // emulate FK CASCADE / SET NULL
      await auditLog('delete', 'users', req.params.id, actorLabel(req), { name: removed.name });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[admin/users DELETE]', err);
      return res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  REPORTS                                                        ║
  // ╚════════════════════════════════════════════════════════════════╝

  // Urgency ordering — the statuses an EOC must act on float to the top.
  const URGENCY_BRANCHES = [
    ['need_help', 1], ['missing', 2], ['verified_missing', 3], ['potentially_missing', 4],
    ['injured', 5], ['awaiting_response', 6], ['deceased', 7], ['rescued', 8], ['safe', 9],
  ].map(([s, n]) => ({ case: { $eq: ['$status', s] }, then: n }));

  router.get('/reports', async (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    const status     = blank(req.query.status);
    const reportedBy = blank(req.query.reported_by);
    const userType   = blank(req.query.user_type);
    const disasterId = req.query.disaster_id; // id | '__any__' | '__none__' | undefined

    const filter = {};
    const and = [];
    if (req.query.q) {
      const rx = ilike(req.query.q);
      and.push({ $or: [{ name: rx }, { phone: rx }] });
    }
    if (status)     filter.status = status;
    if (reportedBy) filter.reported_by = reportedBy;
    if (userType)   filter.user_type = userType;
    if (disasterId === '__none__')     filter.disaster_id = null;
    else if (disasterId === '__any__') filter.disaster_id = { $ne: null };
    else if (blank(disasterId))        filter.disaster_id = disasterId;
    if (and.length) filter.$and = and;

    try {
      const page = await collection('reports').aggregate([
        { $match: filter },
        { $addFields: { _urgency: { $switch: { branches: URGENCY_BRANCHES, default: 10 } } } },
        { $sort: { _urgency: 1, updated_at: -1 } },
        { $skip: offset },
        { $limit: limit },
      ]).toArray();
      const total = await collection('reports').countDocuments(filter);

      // LEFT JOIN users → user_name / user_phone.
      const userIds = [...new Set(page.map((r) => r.user_id).filter(Boolean))];
      const users = userIds.length
        ? await collection('users').find({ _id: { $in: userIds } }).project({ _id: 1, name: 1, phone: 1 }).toArray()
        : [];
      const byId = new Map(users.map((u) => [u._id, u]));

      const rows = page.map((r) => {
        const u = r.user_id ? byId.get(r.user_id) : null;
        const { _id, name_lower, _urgency, ...rest } = r;
        return { id: _id, ...rest, user_name: u ? u.name : null, user_phone: u ? u.phone : null };
      });
      return res.json({ rows, total });
    } catch (err) {
      console.error('[admin/reports GET]', err);
      return res.status(500).json({ error: 'Failed to list reports' });
    }
  });

  router.post('/reports', async (req, res) => {
    const { name, status, lat, lng, medical_notes, phone, personal_id, disaster_id, user_id } = req.body || {};
    if (!name || !status || lat == null || lng == null) {
      return res.status(400).json({ error: 'name, status, lat, lng are required' });
    }
    if (!VALID_REPORT_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_REPORT_STATUS.join(', ')}` });
    }
    try {
      const id  = crypto.randomUUID();
      const now = Date.now();
      const doc = {
        _id: id, name, name_lower: String(name).toLowerCase(), status, lat, lng,
        medical_notes: medical_notes ?? null, phone: phone ?? null,
        personal_id: personal_id ?? null, disaster_id: disaster_id ?? null,
        relay_count: 0, reported_by: null, reporter_name: null, user_type: 'mobile',
        user_id: user_id ?? null, reported_for_user_id: null,
        created_at: now, updated_at: now,
      };
      await collection('reports').insertOne(doc);
      await auditLog('create', 'reports', id, actorLabel(req), { name, status });
      return res.status(201).json({ ok: true, report: mapId(doc) });
    } catch (err) {
      console.error('[admin/reports POST]', err);
      return res.status(500).json({ error: 'Failed to create report' });
    }
  });

  router.put('/reports/:id', async (req, res) => {
    const { name, status, lat, lng, medical_notes, phone, personal_id, disaster_id } = req.body || {};
    if (blank(status) && !VALID_REPORT_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_REPORT_STATUS.join(', ')}` });
    }
    try {
      const set = { updated_at: Date.now() };
      const nameVal = blank(name);
      if (nameVal !== null) { set.name = nameVal; set.name_lower = String(nameVal).toLowerCase(); }
      const statusVal = blank(status);     if (statusVal !== null) set.status = statusVal;
      const latVal = blank(lat);           if (latVal !== null) set.lat = latVal;
      const lngVal = blank(lng);           if (lngVal !== null) set.lng = lngVal;
      const mnVal = blank(medical_notes);  if (mnVal !== null) set.medical_notes = mnVal;
      const phoneVal = blank(phone);       if (phoneVal !== null) set.phone = phoneVal;
      const pidVal = blank(personal_id);   if (pidVal !== null) set.personal_id = pidVal;
      const didVal = blank(disaster_id);   if (didVal !== null) set.disaster_id = didVal;

      const result = await collection('reports').findOneAndUpdate(
        { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Report not found' });
      await auditLog('update', 'reports', req.params.id, actorLabel(req), { name, status });
      return res.json({ ok: true, report: mapId(doc) });
    } catch (err) {
      console.error('[admin/reports PUT]', err);
      return res.status(500).json({ error: 'Failed to update report' });
    }
  });

  router.delete('/reports/:id', async (req, res) => {
    try {
      const removed = unwrap(await collection('reports').findOneAndDelete(
        { _id: req.params.id }, { projection: { name: 1 } }
      ));
      if (!removed) return res.status(404).json({ error: 'Report not found' });
      await collection('status_history').deleteMany({ report_id: req.params.id }).catch(() => {});
      await auditLog('delete', 'reports', req.params.id, actorLabel(req), { name: removed.name });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[admin/reports DELETE]', err);
      return res.status(500).json({ error: 'Failed to delete report' });
    }
  });

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  DISASTERS                                                      ║
  // ╚════════════════════════════════════════════════════════════════╝

  router.get('/disasters', async (req, res) => {
    const active = req.query.active; // 'true' | 'false' | undefined
    const type   = blank(req.query.type);

    const filter = {};
    if (active === 'true' || active === 'false') filter.active = (active === 'true');
    if (type) filter.type = type;

    try {
      const docs = await collection('disasters').find(filter).toArray();
      // ORDER BY active DESC, COALESCE(severity,0) DESC, started_at DESC LIMIT 200.
      docs.sort((a, b) => {
        const av = a.active ? 1 : 0, bv = b.active ? 1 : 0;
        if (av !== bv) return bv - av;
        const as = a.severity ?? 0, bs = b.severity ?? 0;
        if (as !== bs) return bs - as;
        return (b.started_at || 0) - (a.started_at || 0);
      });
      return res.json({ rows: docs.slice(0, 200).map(mapId) });
    } catch (err) {
      console.error('[admin/disasters GET]', err);
      return res.status(500).json({ error: 'Failed to list disasters' });
    }
  });

  router.post('/disasters', async (req, res) => {
    const { type, magnitude, severity, lat, lng, radius_km, description, active = true } = req.body || {};
    if (!type || lat == null || lng == null || !radius_km) {
      return res.status(400).json({ error: 'type, lat, lng, radius_km are required' });
    }
    try {
      const id  = crypto.randomUUID();
      const now = Date.now();
      const doc = {
        _id: id, type, magnitude: magnitude ?? null, severity: severity ?? null,
        lat, lng, radius_km, description: description ?? null, active,
        started_at: now, ended_at: null,
      };
      await collection('disasters').insertOne(doc);
      await auditLog('create', 'disasters', id, actorLabel(req), { type, lat, lng });
      return res.status(201).json({ ok: true, disaster: mapId(doc) });
    } catch (err) {
      console.error('[admin/disasters POST]', err);
      return res.status(500).json({ error: 'Failed to create disaster' });
    }
  });

  router.put('/disasters/:id', async (req, res) => {
    const { type, magnitude, severity, lat, lng, radius_km, description, active, ended_at } = req.body || {};
    try {
      const set = {};
      const typeVal = blank(type);             if (typeVal !== null) set.type = typeVal;
      const magVal = blank(magnitude);          if (magVal !== null) set.magnitude = magVal;
      const sevVal = blank(severity);           if (sevVal !== null) set.severity = sevVal;
      const latVal = blank(lat);                if (latVal !== null) set.lat = latVal;
      const lngVal = blank(lng);                if (lngVal !== null) set.lng = lngVal;
      const radVal = blank(radius_km);          if (radVal !== null) set.radius_km = radVal;
      const descVal = blank(description);       if (descVal !== null) set.description = descVal;
      if (active !== undefined && active !== null) set.active = active;
      const endedVal = blank(ended_at);         if (endedVal !== null) set.ended_at = endedVal;

      const result = await collection('disasters').findOneAndUpdate(
        { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Disaster not found' });
      await auditLog('update', 'disasters', req.params.id, actorLabel(req), { type, active });
      return res.json({ ok: true, disaster: mapId(doc) });
    } catch (err) {
      console.error('[admin/disasters PUT]', err);
      return res.status(500).json({ error: 'Failed to update disaster' });
    }
  });

  router.delete('/disasters/:id', async (req, res) => {
    try {
      const removed = unwrap(await collection('disasters').findOneAndDelete(
        { _id: req.params.id }, { projection: { type: 1 } }
      ));
      if (!removed) return res.status(404).json({ error: 'Disaster not found' });
      // reports.disaster_id had ON DELETE SET NULL — emulate it.
      await collection('reports').updateMany({ disaster_id: req.params.id }, { $set: { disaster_id: null } });
      await auditLog('delete', 'disasters', req.params.id, actorLabel(req), { type: removed.type });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[admin/disasters DELETE]', err);
      return res.status(500).json({ error: 'Failed to delete disaster' });
    }
  });

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  ACCOUNT LINKS                                                  ║
  // ╚════════════════════════════════════════════════════════════════╝

  router.get('/links', async (req, res) => {
    const limit  = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const status = blank(req.query.status);

    try {
      const filter = {};
      if (status) filter.status = status;
      if (req.query.q) {
        // Search matches name/phone of EITHER party → resolve matching user ids first.
        const rx = ilike(req.query.q);
        const matched = await collection('users').find({ $or: [{ name: rx }, { phone: rx }] }).project({ _id: 1 }).toArray();
        const ids = matched.map((u) => u._id);
        filter.$or = [{ user_a_id: { $in: ids } }, { user_b_id: { $in: ids } }];
      }

      const total = await collection('account_links').countDocuments(filter);
      const links = await collection('account_links')
        .find(filter).sort({ created_at: -1 }).skip(offset).limit(limit).toArray();

      const allIds = [...new Set(links.flatMap((l) => [l.user_a_id, l.user_b_id]).filter(Boolean))];
      const users = allIds.length
        ? await collection('users').find({ _id: { $in: allIds } }).project({ _id: 1, name: 1, phone: 1 }).toArray()
        : [];
      const byId = new Map(users.map((u) => [u._id, u]));

      const rows = [];
      for (const l of links) {
        const ua = byId.get(l.user_a_id), ub = byId.get(l.user_b_id);
        if (!ua || !ub) continue; // INNER JOIN drops a link missing either party
        rows.push({
          id: l._id, status: l.status, confirmed_at: l.confirmed_at ?? null, created_at: l.created_at,
          user_a_id: l.user_a_id, user_a_name: ua.name, user_a_phone: ua.phone,
          user_b_id: l.user_b_id, user_b_name: ub.name, user_b_phone: ub.phone,
        });
      }
      return res.json({ rows, total });
    } catch (err) {
      console.error('[admin/links GET]', err);
      return res.status(500).json({ error: 'Failed to list links' });
    }
  });

  router.put('/links/:id', async (req, res) => {
    const { status } = req.body || {};
    const allowed = ['pending', 'confirmed', 'blocked'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    }
    try {
      const set = { status };
      if (status === 'confirmed') set.confirmed_at = Date.now(); // else keep existing
      const result = await collection('account_links').findOneAndUpdate(
        { _id: req.params.id }, { $set: set }, { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Link not found' });
      await auditLog('update', 'account_links', req.params.id, actorLabel(req), { status });
      return res.json({ ok: true, link: mapId(doc) });
    } catch (err) {
      console.error('[admin/links PUT]', err);
      return res.status(500).json({ error: 'Failed to update link' });
    }
  });

  router.delete('/links/:id', async (req, res) => {
    try {
      const removed = unwrap(await collection('account_links').findOneAndDelete({ _id: req.params.id }, { projection: { _id: 1 } }));
      if (!removed) return res.status(404).json({ error: 'Link not found' });
      await auditLog('delete', 'account_links', req.params.id, actorLabel(req), null);
      return res.json({ ok: true });
    } catch (err) {
      console.error('[admin/links DELETE]', err);
      return res.status(500).json({ error: 'Failed to delete link' });
    }
  });

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  DEVICE PUSH TOKENS                                             ║
  // ╚════════════════════════════════════════════════════════════════╝

  router.get('/devices', async (req, res) => {
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
      const page = await collection('device_push_tokens').aggregate([
        { $match: filter },
        { $addFields: { _located: { $cond: [{ $and: [{ $ne: ['$lat', null] }, { $ne: ['$lng', null] }] }, 1, 0] } } },
        { $sort: { _located: -1, updated_at: -1 } },
        { $skip: offset },
        { $limit: limit },
      ]).toArray();
      const total = await collection('device_push_tokens').countDocuments(filter);

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
      return res.json({ rows, total });
    } catch (err) {
      console.error('[admin/devices GET]', err);
      return res.status(500).json({ error: 'Failed to list devices' });
    }
  });

  router.delete('/devices/:id', async (req, res) => {
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
      return res.json({ rows: docs.map(mapId) });
    } catch (err) {
      console.error('[admin/audit GET]', err);
      return res.status(500).json({ error: 'Failed to load audit log' });
    }
  });

  return router;
};
