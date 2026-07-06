'use strict';

const express = require('express');
const { UserRegisterSchema, UserUpdateSchema, LoginSchema, LinkRequestSchema, ResponderProfileSchema } = require('../lib/zodSchemas');
const { authenticate, isOwnerOrGov, refreshTokenTtlMs } = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');
const { validate, asyncHandler, HttpError } = require('../lib/http');
const { errorHandler } = require('../lib/errorHandler');
const otpService = require('../lib/otpService');
const userStore = require('../services/userStore');
const linkStore = require('../services/linkStore');

const REFRESH_COOKIE = 'rs_refresh';
const REFRESH_PATH = '/api/users/token/refresh';

/**
 * The refresh token reaches web clients as an httpOnly cookie so an XSS can't
 * read it from localStorage (the 30-day account-takeover path). It is also
 * still returned in the JSON body for the mobile app, which has no cookie jar.
 * Path-scoped to the refresh endpoint + SameSite=Strict covers CSRF for it.
 */
function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: refreshTokenTtlMs(),
  });
}

/** Read a cookie value from the raw header (no cookie-parser dependency). */
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The token fields every token-issuing response returns. */
function tokenBody(tok) {
  return {
    access_token:  tok.accessToken,
    refresh_token: tok.refreshToken,
    expires_at:    tok.accessTokenExpiresAt,
    token_type:    'Bearer',
  };
}

/** After authenticate: only the owner named by :param (or gov) may proceed. */
const own = (param) => (req, res, next) => {
  if (!isOwnerOrGov(req, req.params[param])) {
    return next(new HttpError(403, 'Forbidden — you may only access your own account.'));
  }
  return next();
};

/**
 * If OTP enforcement is on, the request body must carry a valid `otp` for the
 * (already-normalised) phone. No-op when OTP_ENABLED is off — register/login
 * stay frictionless for testing.
 */
async function assertOtp(req, phone) {
  if (!otpService.isEnabled()) return;
  const otp = req.body?.otp;
  if (otp && (await otpService.verifyOtp(phone, String(otp)))) return;
  throw new HttpError(401, 'A valid OTP is required. Request one via POST /api/users/request-otp.', 'otp_required');
}

module.exports = function createUsersRouter() {
  const router = express.Router();

  // Registration + linking are abuse/enumeration vectors → rate-limited.
  const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many registrations from this address.' });
  const linkLimiter     = rateLimit({ windowMs: 60 * 60 * 1000, max: 50, message: 'Link request limit reached (50/hour).' });
  // Token refresh is a credential operation — limit brute-force attempts.
  const refreshLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Too many token refresh attempts.' });
  // OTP requests are an SMS-cost + enumeration vector — limit them.
  const otpLimiter      = rateLimit({ windowMs: 15 * 60 * 1000, max: 5,  message: 'Too many OTP requests — try again later.' });

  // POST /api/users/request-otp — send a one-time passcode to a phone. Always
  // available; only meaningful when OTP_ENABLED=true. In dev the code is echoed
  // back (dev_code) so testers need no real SMS gateway.
  router.post('/request-otp', otpLimiter, validate(LoginSchema), asyncHandler(async (req, res) => {
    const result = await otpService.requestOtp(req.valid.phone);
    res.json({ ok: true, data: { enabled: otpService.isEnabled(), ...result } });
  }));

  // POST /api/users/register — create or update the account for a phone.
  // Tokens are returned once; the client stores both.
  router.post('/register', registerLimiter, validate(UserRegisterSchema), asyncHandler(async (req, res) => {
    await assertOtp(req, req.valid.phone);
    const { user, tok } = await userStore.register(req.valid);
    setRefreshCookie(res, tok.refreshToken); // web reads the cookie; mobile uses the body
    res.status(201).json({ ok: true, user, ...tokenBody(tok) });
  }));

  // POST /api/users/login — phone-only login for an existing account. Citizens
  // have no password in this system; OTP (when enabled) proves phone ownership.
  router.post('/login', registerLimiter, validate(LoginSchema), asyncHandler(async (req, res) => {
    await assertOtp(req, req.valid.phone);
    const { user, tok } = await userStore.login(req.valid.phone);
    setRefreshCookie(res, tok.refreshToken);
    res.json({ ok: true, user, ...tokenBody(tok) });
  }));

  // POST /api/users/token/refresh — exchange a valid refresh token for a new
  // pair. Web sends it via the httpOnly cookie; mobile via the body.
  router.post('/token/refresh', refreshLimiter, asyncHandler(async (req, res) => {
    const presented = readCookie(req, REFRESH_COOKIE) || req.body?.refresh_token;
    if (!presented || typeof presented !== 'string') {
      throw new HttpError(400, 'refresh_token is required');
    }
    const tok = await userStore.rotateRefreshToken(presented);
    setRefreshCookie(res, tok.refreshToken); // rotate the cookie too
    res.json({ ok: true, ...tokenBody(tok) });
  }));

  // GET /api/users/:phone/profile — owner (by phone) or gov. HKID masked.
  router.get('/:phone/profile', authenticate, asyncHandler(async (req, res) => {
    if (req.auth.kind !== 'gov' && req.auth.user.phone !== req.params.phone) {
      throw new HttpError(403, 'Forbidden — you may only access your own account.');
    }
    res.json({ ok: true, data: await userStore.profileByPhone(req.params.phone) });
  }));

  // PATCH /api/users/:id — update own profile (data-correction right).
  router.patch('/:id', authenticate, own('id'), validate(UserUpdateSchema), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await userStore.updateProfile(req.params.id, req.valid) });
  }));

  // DELETE /api/users/:id — PDPO erasure. Deletes the account and scrubs PII
  // from any reports tied to it (two-phase, crash-safe cascade in userStore).
  router.delete('/:id', authenticate, own('id'), asyncHandler(async (req, res) => {
    const result = await userStore.eraseUser(req.params.id);
    if (!result.deleted) throw new HttpError(404, 'User not found');
    res.json({ ok: true, data: result });
  }));

  // PATCH /api/users/:id/responder — CFR opt-in/out + skills + travel radius.
  router.patch('/:id/responder', authenticate, own('id'), validate(ResponderProfileSchema), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await userStore.setResponderProfile(req.params.id, req.valid) });
  }));

  // POST /api/users/:id/links — request to link with another user by phone.
  router.post('/:id/links', authenticate, linkLimiter, own('id'), validate(LinkRequestSchema), asyncHandler(async (req, res) => {
    const data = await linkStore.requestLink(req.params.id, req.valid.target_phone);
    res.status(201).json({ ok: true, data });
  }));

  // PUT /api/users/:id/links/:link_id — confirm a pending link.
  router.put('/:id/links/:link_id', authenticate, own('id'), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await linkStore.confirmLink(req.params.id, req.params.link_id) });
  }));

  // GET /api/users/:id/links — the loved-one roster (partner status only after
  // both sides consent).
  router.get('/:id/links', authenticate, own('id'), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await linkStore.getRoster(req.params.id) });
  }));

  // DELETE /api/users/:id/links/:link_id — remove a link.
  router.delete('/:id/links/:link_id', authenticate, own('id'), asyncHandler(async (req, res) => {
    await linkStore.removeLink(req.params.id, req.params.link_id);
    res.json({ ok: true });
  }));

  // Router-scoped error handler: thrown HttpErrors resolve to their JSON body
  // even when this router is mounted standalone (tests, embedding). The
  // app-level errorHandler in index.js remains the backstop.
  router.use(errorHandler);

  return router;
};
