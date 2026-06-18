'use strict';

const express  = require('express');
const crypto   = require('crypto');
const { collection } = require('../db/mongo');
const reportStore = require('../services/reportStore');
const { UserRegisterSchema, UserUpdateSchema, LoginSchema, LinkRequestSchema } = require('../lib/zodSchemas');
const { authenticate, isOwnerOrGov, generateTokenPair, hashToken } = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');
const otpService = require('../lib/otpService');

/**
 * PCPD masking: an HKID must never travel back out in full on any response
 * the caller didn't already provide. "A1234567" → "A•••••(7)".
 */
function maskPersonalId(pid) {
  if (!pid) return null;
  return `${pid[0]}${'•'.repeat(Math.max(0, pid.length - 2))}(${pid[pid.length - 1]})`;
}

function forbidden(res) {
  return res.status(403).json({ error: 'Forbidden — you may only access your own account.' });
}

/** Map a stored doc's _id → id (used for account_links rows). */
function mapId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

/** Public user shape: _id → id, strip secret hashes, mask the HKID. */
function publicUser(doc) {
  if (!doc) return doc;
  const { _id, access_token_hash, refresh_token_hash, password_hash, name_lower, ...rest } = doc;
  return { id: _id, ...rest, personal_id: maskPersonalId(rest.personal_id) };
}

/** Driver v6 findOneAndUpdate returns the doc directly; v5 wrapped it in {value}. */
function unwrap(res) {
  return res && res.value !== undefined ? res.value : res;
}

/** A MongoDB duplicate-key error (the former Postgres 23505). */
function isDupKey(err) {
  return err && err.code === 11000;
}

module.exports = function createUsersRouter() {
  const router = express.Router();

  // Registration + linking are abuse/enumeration vectors → rate-limited (M2).
  const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many registrations from this address.' });
  const linkLimiter     = rateLimit({ windowMs: 60 * 60 * 1000, max: 50, message: 'Link request limit reached (50/hour).' });
  // Token refresh is a credential operation — limit brute-force attempts.
  const refreshLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Too many token refresh attempts.' });
  // OTP requests are an SMS-cost + enumeration vector — limit them.
  const otpLimiter      = rateLimit({ windowMs: 15 * 60 * 1000, max: 5,  message: 'Too many OTP requests — try again later.' });

  /**
   * If OTP enforcement is on, the request body must carry a valid `otp` for the
   * (already-normalised) phone. No-op when OTP_ENABLED is off → register/login
   * stay frictionless for testing. Returns true when the caller may proceed.
   */
  function otpOk(req, res, phone) {
    if (!otpService.isEnabled()) return true;
    const otp = req.body?.otp;
    if (!otp || !otpService.verifyOtp(phone, String(otp))) {
      res.status(401).json({ error: 'A valid OTP is required. Request one via POST /api/users/request-otp.', code: 'otp_required' });
      return false;
    }
    return true;
  }

  // POST /api/users/request-otp — send a one-time passcode to a phone. Always
  // available; only MEANINGFUL when OTP_ENABLED=true. In dev the code is echoed
  // back (dev_code) so testers need no real SMS gateway.
  router.post('/request-otp', otpLimiter, async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body); // { phone } → normalised +852…
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    try {
      const result = await otpService.requestOtp(parsed.data.phone);
      return res.json({ ok: true, enabled: otpService.isEnabled(), ...result });
    } catch (err) {
      console.error('[users POST /request-otp] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/users/register — create or return existing user by phone.
  // Full name, phone, personal_id (HKID) and privacy_consent are required.
  // Issues a one-time personal access token the client must store to manage
  // its own profile/links afterwards.
  router.post('/register', registerLimiter, async (req, res) => {
    const parsed = UserRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { phone, name, email, personal_id, user_type, privacy_consent } = parsed.data;
    // OTP gate (no-op unless OTP_ENABLED=true) — proves phone ownership.
    if (!otpOk(req, res, phone)) return;
    const now = Date.now();
    const id  = crypto.randomUUID();
    const tok = generateTokenPair(now);
    try {
      // Upsert by phone (the former INSERT … ON CONFLICT (phone) DO UPDATE).
      // COALESCE semantics: provided fields overwrite, absent ones keep prior.
      // user_type/role/created_at are insert-only (never changed on conflict).
      const setOnInsert = { _id: id, phone, user_type, role: 'citizen', created_at: now };
      const set = {
        name,
        personal_id,
        privacy_consent,
        access_token_hash:        tok.accessTokenHash,
        access_token_expires_at:  tok.accessTokenExpiresAt,
        refresh_token_hash:       tok.refreshTokenHash,
        refresh_token_expires_at: tok.refreshTokenExpiresAt,
        updated_at:               now,
      };
      if (email != null) set.email = email; else setOnInsert.email = null;

      const result = await collection('users').findOneAndUpdate(
        { phone },
        { $setOnInsert: setOnInsert, $set: set },
        { upsert: true, returnDocument: 'after' }
      );
      const user = publicUser(unwrap(result));
      // Tokens are returned ONCE. Client stores both: the access token authorises
      // requests; the refresh token (POST /token/refresh) mints a new pair when
      // the access token expires.
      return res.status(201).json({
        ok: true,
        user,
        access_token:  tok.accessToken,
        refresh_token: tok.refreshToken,
        expires_at:    tok.accessTokenExpiresAt,
        token_type:    'Bearer',
      });
    } catch (err) {
      if (isDupKey(err)) {
        return res.status(409).json({ error: 'This personal ID is already registered to another phone number.' });
      }
      console.error('[users POST /register] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/users/login — phone-only login for an EXISTING account. Issues a
  // fresh access+refresh token pair. (Citizens have no password in this system;
  // this is the same trust model as registration, which already mints tokens for
  // any phone. Production would add OTP/SMS verification here.)
  router.post('/login', registerLimiter, async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { phone } = parsed.data;
    // OTP gate (no-op unless OTP_ENABLED=true) — proves phone ownership.
    if (!otpOk(req, res, phone)) return;
    try {
      const found = await collection('users').findOne(
        { phone },
        { projection: { phone: 1, name: 1, email: 1, personal_id: 1, user_type: 1, role: 1, privacy_consent: 1 } }
      );
      if (!found) {
        return res.status(404).json({ error: 'No account found for that number. Please register first.' });
      }
      const now = Date.now();
      const tok = generateTokenPair(now);
      await collection('users').updateOne(
        { _id: found._id },
        { $set: {
            access_token_hash: tok.accessTokenHash, access_token_expires_at: tok.accessTokenExpiresAt,
            refresh_token_hash: tok.refreshTokenHash, refresh_token_expires_at: tok.refreshTokenExpiresAt,
            updated_at: now,
        } }
      );
      const user = { ...mapId(found), personal_id: maskPersonalId(found.personal_id) };
      return res.json({
        ok: true,
        user,
        access_token:  tok.accessToken,
        refresh_token: tok.refreshToken,
        expires_at:    tok.accessTokenExpiresAt,
        token_type:    'Bearer',
      });
    } catch (err) {
      console.error('[users POST /login] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/users/token/refresh — exchange a valid refresh token for a new
  // access+refresh pair. Refresh tokens ROTATE (one-time use): the old one is
  // invalidated, so a stolen-then-used refresh token is detectable (the real
  // user's next refresh fails). Body: { refresh_token }.
  router.post('/token/refresh', refreshLimiter, async (req, res) => {
    const refreshToken = req.body?.refresh_token;
    if (!refreshToken || typeof refreshToken !== 'string') {
      return res.status(400).json({ error: 'refresh_token is required' });
    }
    try {
      const found = await collection('users').findOne(
        { refresh_token_hash: hashToken(refreshToken) },
        { projection: { refresh_token_expires_at: 1 } }
      );
      if (!found) {
        return res.status(401).json({ error: 'Invalid refresh token', code: 'refresh_invalid' });
      }
      const exp = found.refresh_token_expires_at;
      if (exp != null && Number(exp) < Date.now()) {
        return res.status(401).json({ error: 'Refresh token expired', code: 'refresh_expired' });
      }
      const now = Date.now();
      const tok = generateTokenPair(now);
      await collection('users').updateOne(
        { _id: found._id },
        { $set: {
            access_token_hash: tok.accessTokenHash, access_token_expires_at: tok.accessTokenExpiresAt,
            refresh_token_hash: tok.refreshTokenHash, refresh_token_expires_at: tok.refreshTokenExpiresAt,
            updated_at: now,
        } }
      );
      return res.json({
        ok: true,
        access_token:  tok.accessToken,
        refresh_token: tok.refreshToken,
        expires_at:    tok.accessTokenExpiresAt,
        token_type:    'Bearer',
      });
    } catch (err) {
      console.error('[users POST /token/refresh] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/users/:phone/profile — fetch user by phone. Requires auth; only
  // the owner (or gov) may read it. HKID is returned MASKED.
  router.get('/:phone/profile', authenticate, async (req, res) => {
    try {
      if (req.auth.kind !== 'gov' && req.auth.user.phone !== req.params.phone) return forbidden(res);
      const doc = await collection('users').findOne(
        { phone: req.params.phone },
        { projection: { phone: 1, name: 1, email: 1, personal_id: 1, user_type: 1, role: 1, privacy_consent: 1, created_at: 1, updated_at: 1 } }
      );
      if (!doc) return res.status(404).json({ error: 'User not found' });
      const user = { ...mapId(doc), personal_id: maskPersonalId(doc.personal_id) };
      return res.json({ ok: true, user });
    } catch (err) {
      console.error('[users GET /:phone/profile] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PATCH /api/users/:id — update own profile (DPP6 correction). Owner or gov.
  router.patch('/:id', authenticate, async (req, res) => {
    if (!isOwnerOrGov(req, req.params.id)) return forbidden(res);
    const parsed = UserUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { name, email, personal_id, privacy_consent } = parsed.data;
    try {
      // COALESCE($x, col): only overwrite fields the caller actually provided.
      const set = { updated_at: Date.now() };
      if (name != null) set.name = name;
      if (email != null) set.email = email;
      if (personal_id != null) set.personal_id = personal_id;
      if (privacy_consent != null) set.privacy_consent = privacy_consent;

      const result = await collection('users').findOneAndUpdate(
        { _id: req.params.id },
        { $set: set },
        { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'User not found' });
      return res.json({ ok: true, user: publicUser(doc) });
    } catch (err) {
      if (isDupKey(err)) {
        return res.status(409).json({ error: 'This personal ID is already registered to another phone number.' });
      }
      console.error('[users PATCH /:id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/users/:id — PDPO DPP6 erasure. Owner or gov. Deletes the
  // account and scrubs PII from any reports tied to it.
  router.delete('/:id', authenticate, async (req, res) => {
    if (!isOwnerOrGov(req, req.params.id)) return forbidden(res);
    try {
      const result = await reportStore.eraseUserData(req.params.id);
      if (!result.deleted) return res.status(404).json({ error: 'User not found' });
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[users DELETE /:id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/users/:id/links — request to link with another user by phone
  router.post('/:id/links', authenticate, linkLimiter, async (req, res) => {
    if (!isOwnerOrGov(req, req.params.id)) return forbidden(res);
    const parsed = LinkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }
    const { target_phone } = parsed.data;
    try {
      const target = await collection('users').findOne({ phone: target_phone }, { projection: { _id: 1 } });
      if (!target) {
        return res.status(404).json({ error: 'Target user not found' });
      }
      const targetId = target._id;
      if (targetId === req.params.id) {
        return res.status(400).json({ error: 'Cannot link to yourself' });
      }
      const id  = crypto.randomUUID();
      const now = Date.now();
      // INSERT … ON CONFLICT (user_a_id, user_b_id) DO UPDATE → upsert. On insert
      // confirmed_at defaults null; on conflict only status + created_at change.
      const result = await collection('account_links').findOneAndUpdate(
        { user_a_id: req.params.id, user_b_id: targetId },
        { $set: { status: 'pending', created_at: now }, $setOnInsert: { _id: id, confirmed_at: null } },
        { upsert: true, returnDocument: 'after' }
      );
      return res.status(201).json({ ok: true, link: mapId(unwrap(result)) });
    } catch (err) {
      console.error('[users POST /:id/links] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/users/:id/links/:link_id — confirm a pending link
  router.put('/:id/links/:link_id', authenticate, async (req, res) => {
    if (!isOwnerOrGov(req, req.params.id)) return forbidden(res);
    try {
      const result = await collection('account_links').findOneAndUpdate(
        { _id: req.params.link_id, user_b_id: req.params.id, status: 'pending' },
        { $set: { status: 'confirmed', confirmed_at: Date.now() } },
        { returnDocument: 'after' }
      );
      const doc = unwrap(result);
      if (!doc) return res.status(404).json({ error: 'Pending link not found' });
      return res.json({ ok: true, link: mapId(doc) });
    } catch (err) {
      console.error('[users PUT /:id/links/:link_id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/users/:id/links — list this user's loved-one links (confirmed +
  // pending) with the partner's latest report status. `is_incoming` marks a
  // pending request this user can confirm. A pending partner's status is withheld
  // until BOTH sides consent (the link is confirmed) — privacy before acceptance.
  router.get('/:id/links', authenticate, async (req, res) => {
    if (!isOwnerOrGov(req, req.params.id)) return forbidden(res);
    const me = req.params.id;
    try {
      const links = await collection('account_links')
        .find({ $or: [{ user_a_id: me }, { user_b_id: me }], status: { $in: ['pending', 'confirmed'] } })
        .toArray();
      if (links.length === 0) return res.json({ ok: true, links: [] });

      const withPartner = links.map((al) => ({
        al,
        partnerId: al.user_a_id === me ? al.user_b_id : al.user_a_id,
        isIncoming: al.user_b_id === me,
      }));
      const partnerIds = [...new Set(withPartner.map((x) => x.partnerId))];
      const partners = await collection('users')
        .find({ _id: { $in: partnerIds } })
        .project({ _id: 1, phone: 1, name: 1, personal_id: 1 })
        .toArray();
      const partnerById = new Map(partners.map((u) => [u._id, u]));

      // Latest report for a partner, matched by IDENTITY (id / reported-for /
      // HKID / phone), not by display name. Only resolved for confirmed links.
      async function latestReportFor(u) {
        const or = [{ user_id: u._id }, { reported_for_user_id: u._id }];
        if (u.personal_id) or.push({ personal_id: u.personal_id });
        if (u.phone) or.push({ phone: u.phone });
        const docs = await collection('reports')
          .find({ $or: or })
          .project({ status: 1, updated_at: 1, disaster_id: 1 })
          .sort({ updated_at: -1 })
          .limit(1)
          .toArray();
        return docs[0] || null;
      }

      const entries = [];
      for (const { al, partnerId, isIncoming } of withPartner) {
        const u = partnerById.get(partnerId);
        if (!u) continue; // JOIN users — drop a link whose partner vanished
        let report_status = null, status_updated_at = null, disaster_id = null;
        if (al.status === 'confirmed') {
          const r = await latestReportFor(u);
          if (r) {
            report_status = r.status ?? null;
            status_updated_at = r.updated_at != null ? Number(r.updated_at) : null;
            disaster_id = r.disaster_id ?? null;
          }
        }
        entries.push({
          row: {
            link_id: al._id,
            link_status: al.status,
            confirmed_at: al.confirmed_at ?? null,
            is_incoming: isIncoming,
            user_id: u._id,
            phone: u.phone,
            name: u.name,
            report_status,
            status_updated_at,
            disaster_id,
          },
          status: al.status,
          created_at: al.created_at,
        });
      }

      // ORDER BY al.status ASC, al.created_at DESC.
      entries.sort((a, b) => {
        if (a.status !== b.status) return a.status < b.status ? -1 : 1;
        return (b.created_at || 0) - (a.created_at || 0);
      });
      return res.json({ ok: true, links: entries.map((e) => e.row) });
    } catch (err) {
      console.error('[users GET /:id/links] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/users/:id/links/:link_id — remove a link
  router.delete('/:id/links/:link_id', authenticate, async (req, res) => {
    if (!isOwnerOrGov(req, req.params.id)) return forbidden(res);
    try {
      await collection('account_links').deleteOne({
        _id: req.params.link_id,
        $or: [{ user_a_id: req.params.id }, { user_b_id: req.params.id }],
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error('[users DELETE /:id/links/:link_id] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
