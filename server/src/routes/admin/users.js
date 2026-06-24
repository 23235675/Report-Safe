'use strict';

const express = require('express');
const crypto  = require('crypto');
const { collection } = require('../../db/mongo');
const { hashPassword, generateTokenPair } = require('../../lib/authGuard');
const { ilike, unwrap } = require('../../lib/mongoMap');
const {
  blank, VALID_ROLES, VALID_USER_TYPES, mapId, normPhone,
  cascadeUserRemoval, auditLog, actorLabel,
} = require('./shared');

// Mounted at /api/admin/users by index.js (after requireSuperAdmin).
module.exports = function adminUsersRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
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

    // M7: cursor pagination is triggered by the PRESENCE of ?after (even empty:
    // page 1 = `?after=`). In cursor mode every page is _id-ordered (no skip →
    // constant RU/page on Cosmos, no cross-page overlap); without ?after the
    // legacy offset/created_at path the web admin UI uses is unchanged.
    const cursorMode = req.query.after !== undefined;
    const after = blank(req.query.after);
    try {
      const proj = { phone: 1, name: 1, email: 1, personal_id: 1, role: 1, user_type: 1, privacy_consent: 1, created_at: 1, updated_at: 1 };
      const [rows, total] = await Promise.all([
        cursorMode
          ? collection('users').find(after ? { ...filter, _id: { $gt: after } } : filter).project(proj).sort({ _id: 1 }).limit(limit).toArray()
          : collection('users').find(filter).project(proj).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
        collection('users').countDocuments(filter),
      ]);
      const next_cursor = rows.length === limit ? rows[rows.length - 1]._id : null;
      return res.json({ ok: true, data: rows.map(mapId), meta: { total, next_cursor } });
    } catch (err) {
      console.error('[admin/users GET]', err);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  });

  router.post('/', async (req, res) => {
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

  router.put('/:id', async (req, res) => {
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
        data: {
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

  router.delete('/:id', async (req, res) => {
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

  return router;
};
