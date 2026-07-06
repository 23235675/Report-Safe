'use strict';

/**
 * Authentication for privileged + user-scoped routes.
 *
 * One resolution core (`resolvePrincipal`) + one middleware factory
 * (`requireRole`) back every guard:
 *
 *  - `authGuard`           — government/admin only (static GOV_TOKEN, no DB).
 *  - `authenticate`        — any principal: gov token OR a user's personal
 *                            access token. Attaches `req.auth = { kind, userId, user }`.
 *  - `allowGovOrVolunteer` — gov token OR user with role government|volunteer.
 *  - `requireSuperAdmin`   — user with role super_admin (the static gov token
 *                            is NOT accepted). Attaches `req.admin`.
 *
 * PRODUCTION NOTE: replace the static gov token with OAuth2/OIDC + RBAC; the
 * middleware contracts stay the same.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { logger } = require('./logger');

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
    logger.warn('gov_token_default_in_production', { note: 'set a strong GOV_TOKEN env var' });
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
 * Resolve a bearer token to a principal. The single implementation behind
 * every role guard.
 *
 * @param {string|null} token the presented bearer token
 * @param {{ roles?: string[]|null, allowGovToken?: boolean }} [opts]
 *   roles         — restrict user principals to these roles. The role is part
 *                   of the LOOKUP filter (matching the original guards), so a
 *                   wrong-role token and an unknown token are indistinguishable
 *                   (both resolve `forbidden`) — no token-validity oracle.
 *   allowGovToken — whether the static gov token is an acceptable principal.
 * @returns {Promise<
 *   { kind: 'gov', userId: null, user: null } |
 *   { kind: 'user', userId: string, user: object } |
 *   { kind: 'none' | 'invalid' | 'forbidden' | 'expired' }
 * >}
 */
async function resolvePrincipal(token, { roles = null, allowGovToken = true } = {}) {
  if (!token) return { kind: 'none' };

  if (allowGovToken && timingEqual(token, getGovToken())) {
    return { kind: 'gov', userId: null, user: null };
  }

  const filter = { access_token_hash: hashToken(token) };
  if (roles) filter.role = { $in: roles };
  const doc = await collection('users').findOne(filter, { projection: PRINCIPAL_PROJECTION });
  if (!doc) return { kind: roles ? 'forbidden' : 'invalid' };

  // Enforce expiry. NULL/absent = legacy token minted before lifecycles
  // existed → still honoured (back-compat) until the user re-registers/refreshes.
  const exp = doc.access_token_expires_at;
  if (exp != null && Number(exp) < Date.now()) return { kind: 'expired' };

  const user = mapPrincipal(doc);
  return { kind: 'user', userId: user.id, user };
}

/**
 * Middleware factory over resolvePrincipal. Attaches the principal to
 * req[attach] ('auth' by default; 'admin' for the super-admin guard) and maps
 * the failure kinds to the guards' original status codes and bodies.
 */
function requireRole({ roles = null, allowGovToken = true, attach = 'auth', forbiddenMsg = 'Forbidden' } = {}) {
  return async function roleGuard(req, res, next) {
    try {
      const p = await resolvePrincipal(bearer(req), { roles, allowGovToken });
      if (p.kind === 'none' || p.kind === 'invalid') {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (p.kind === 'forbidden') {
        return res.status(403).json({ error: forbiddenMsg });
      }
      if (p.kind === 'expired') {
        return res.status(401).json({ error: 'Access token expired', code: 'token_expired' });
      }
      req[attach] = attach === 'admin' ? p.user : p;
      return next();
    } catch (err) {
      logger.error('auth_guard_failed', { reqId: req.id, error: err.message });
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

/**
 * Government/admin-only guard (static bearer token, timing-safe compare).
 * Deliberately DB-free and attaches nothing — a pure gate.
 */
function authGuard(req, res, next) {
  try {
    const token = bearer(req);
    if (!token || !timingEqual(token, getGovToken())) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  } catch (err) {
    logger.error('auth_guard_failed', { reqId: req.id, error: err.message });
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

/**
 * Resolve a Bearer token to a principal:
 *   - gov token  → req.auth = { kind:'gov',  userId:null, user:null }
 *   - user token → req.auth = { kind:'user', userId, user:{id,phone,name,role} }
 * 401 if absent/invalid.
 */
const authenticate = requireRole();

/**
 * Gov token OR authenticated user with role='government' or 'volunteer'.
 * Used for shelter management + safe-place moderation. Attaches req.auth.
 */
const allowGovOrVolunteer = requireRole({
  roles: ['government', 'volunteer'],
  forbiddenMsg: 'Forbidden — government or volunteer role required',
});

/**
 * Requires a Bearer token resolving to a user with role='super_admin' (the
 * static gov token is not accepted). Attaches `req.admin`.
 */
const requireSuperAdmin = requireRole({
  roles: ['super_admin'],
  allowGovToken: false,
  attach: 'admin',
  forbiddenMsg: 'Forbidden — super_admin role required',
});

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

module.exports = {
  authGuard,
  authenticate,
  isOwnerOrGov,
  allowGovOrVolunteer,
  requireSuperAdmin,
  resolvePrincipal,
  requireRole,
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
