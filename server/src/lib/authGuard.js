'use strict';

/**
 * Authentication for privileged + user-scoped routes.
 *
 *  - `authGuard`     — government/admin only (static GOV_TOKEN). Used by
 *                      /rescue, /disasters/trigger, shelter writes.
 *  - `authenticate`  — resolves a Bearer token to a principal: the gov token
 *                      (admin) OR a user's personal access token (issued at
 *                      registration). Attaches `req.auth = { kind, userId, user }`.
 *                      Used to close the unauthenticated IDOR on /api/users/* (M1).
 *
 * PRODUCTION NOTE: replace the static gov token with OAuth2/OIDC + RBAC; the
 * middleware contracts stay the same.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');

const DEFAULT_GOV_TOKEN = 'GOV-SECRET-TOKEN-2024';

/** Project a user doc to the principal shape callers expect (_id → id). */
function mapPrincipal(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    phone: doc.phone,
    name: doc.name,
    role: doc.role,
    access_token_expires_at: doc.access_token_expires_at,
  };
}

/** Projection shared by every token-resolution lookup. */
const PRINCIPAL_PROJECTION = { phone: 1, name: 1, role: 1, access_token_expires_at: 1 };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

/** Access-token lifetime (hours). Short-lived; refreshed via the refresh token. */
function accessTokenTtlMs() {
  return (Number(process.env.ACCESS_TOKEN_TTL_HOURS) || 24) * HOUR_MS;
}
/** Refresh-token lifetime (days). Long-lived; rotated on every refresh. */
function refreshTokenTtlMs() {
  return (Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30) * DAY_MS;
}

function getGovToken() {
  const tok = process.env.GOV_TOKEN || DEFAULT_GOV_TOKEN;
  // Loud warning if the well-known default token is used outside development —
  // a public deployment MUST override GOV_TOKEN with a real secret.
  if (tok === DEFAULT_GOV_TOKEN && process.env.NODE_ENV === 'production') {
    console.warn('[authGuard] SECURITY: GOV_TOKEN is still the built-in default in production. Set a strong GOV_TOKEN env var.');
  }
  return tok;
}

/** Constant-time string comparison (avoids timing side-channels). */
function timingEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** SHA-256 hex of a token — only the hash is ever stored. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Mint a new opaque user access token and its storable hash. */
function generateAccessToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/**
 * Mint an access + refresh token pair with expiries. Only the hashes are ever
 * stored; the plaintext tokens are returned to the client exactly once.
 * @returns {{
 *   accessToken:string, accessTokenHash:string, accessTokenExpiresAt:number,
 *   refreshToken:string, refreshTokenHash:string, refreshTokenExpiresAt:number
 * }}
 */
function generateTokenPair(now = Date.now()) {
  const access  = crypto.randomBytes(32).toString('base64url');
  const refresh = crypto.randomBytes(48).toString('base64url');
  return {
    accessToken:           access,
    accessTokenHash:       hashToken(access),
    accessTokenExpiresAt:  now + accessTokenTtlMs(),
    refreshToken:          refresh,
    refreshTokenHash:      hashToken(refresh),
    refreshTokenExpiresAt: now + refreshTokenTtlMs(),
  };
}

function bearer(req) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Government/admin-only guard (static bearer token, timing-safe compare).
 */
function authGuard(req, res, next) {
  try {
    const token = bearer(req);
    if (!token || !timingEqual(token, getGovToken())) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  } catch (err) {
    console.error('[authGuard] failed to evaluate authorization header:', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/**
 * Resolve a Bearer token to a principal:
 *   - gov token  → req.auth = { kind:'gov',  userId:null, user:null }
 *   - user token → req.auth = { kind:'user', userId, user:{id,phone,name,role} }
 * 401 if absent/invalid.
 */
async function authenticate(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    if (timingEqual(token, getGovToken())) {
      req.auth = { kind: 'gov', userId: null, user: null };
      return next();
    }

    const doc = await collection('users').findOne(
      { access_token_hash: hashToken(token) },
      { projection: PRINCIPAL_PROJECTION }
    );
    if (!doc) return res.status(401).json({ error: 'Unauthorized' });

    // Enforce expiry. NULL/absent = legacy token minted before lifecycles
    // existed → still honoured (back-compat) until the user re-registers/refreshes.
    const exp = doc.access_token_expires_at;
    if (exp != null && Number(exp) < Date.now()) {
      return res.status(401).json({ error: 'Access token expired', code: 'token_expired' });
    }

    const user = mapPrincipal(doc);
    req.auth = { kind: 'user', userId: user.id, user };
    return next();
  } catch (err) {
    console.error('[authenticate] failed:', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/**
 * After `authenticate`, require the principal to be gov OR the owner.
 * `ownerId` is the user id allowed to access the resource.
 */
function isOwnerOrGov(req, ownerId) {
  return req.auth && (req.auth.kind === 'gov' || req.auth.userId === ownerId);
}

/**
 * Hash a password using scrypt (CPU-hard, timing-safe). Returns "salt:hash" string.
 * Synchronous — only called during login or admin seed, never on hot paths.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a plaintext password against a stored "salt:hash" string.
 * Returns false instead of throwing on any error.
 */
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const verify = crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), verify);
  } catch {
    return false;
  }
}

/**
 * Express middleware: allows government token OR authenticated user with
 * role='government' or 'volunteer'. Used for shelter management.
 * Attaches either `req.auth` (user) or signals gov token via 401 if denied.
 */
async function allowGovOrVolunteer(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // Allow the static gov token
    if (timingEqual(token, getGovToken())) {
      req.auth = { kind: 'gov', userId: null, user: null };
      return next();
    }

    // Allow user token with role='government' or 'volunteer'
    const doc = await collection('users').findOne(
      { access_token_hash: hashToken(token), role: { $in: ['government', 'volunteer'] } },
      { projection: PRINCIPAL_PROJECTION }
    );
    if (!doc) return res.status(403).json({ error: 'Forbidden — government or volunteer role required' });

    const exp = doc.access_token_expires_at;
    if (exp != null && Number(exp) < Date.now()) {
      return res.status(401).json({ error: 'Access token expired', code: 'token_expired' });
    }

    const user = mapPrincipal(doc);
    req.auth = { kind: 'user', userId: user.id, user };
    return next();
  } catch (err) {
    console.error('[allowGovOrVolunteer] failed:', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/**
 * Express middleware: requires the request to carry a valid Bearer token that
 * resolves to a user with role = 'super_admin'. Attaches `req.admin`.
 */
async function requireSuperAdmin(req, res, next) {
  try {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const doc = await collection('users').findOne(
      { access_token_hash: hashToken(token), role: 'super_admin' },
      { projection: PRINCIPAL_PROJECTION }
    );
    if (!doc) return res.status(403).json({ error: 'Forbidden — super_admin role required' });

    const exp = doc.access_token_expires_at;
    if (exp != null && Number(exp) < Date.now()) {
      return res.status(401).json({ error: 'Access token expired', code: 'token_expired' });
    }

    req.admin = mapPrincipal(doc);
    return next();
  } catch (err) {
    console.error('[requireSuperAdmin] failed:', err);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = {
  authGuard,
  authenticate,
  isOwnerOrGov,
  allowGovOrVolunteer,
  requireSuperAdmin,
  hashPassword,
  verifyPassword,
  getGovToken,
  hashToken,
  generateAccessToken,
  generateTokenPair,
  accessTokenTtlMs,
  refreshTokenTtlMs,
  timingEqual,
  DEFAULT_GOV_TOKEN,
};
