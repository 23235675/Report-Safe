import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Token lifecycle hardening: access tokens expire, refresh tokens rotate.
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const {
  generateTokenPair, hashToken, authenticate, generateAccessToken,
} = require('../server/src/lib/authGuard');

beforeAll(async () => { await setup(); }, 30000);
beforeEach(async () => { await collection('users').deleteMany({}); });
afterAll(async () => { await closeDb(); });

/** Minimal Express req/res doubles so we can drive `authenticate` directly. */
function fakeReq(token) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}
function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function insertUser({ id, phone, accessHash, accessExp, refreshHash, refreshExp }) {
  const now = Date.now();
  await collection('users').insertOne({
    _id: id, phone, name: 'Token Tester', user_type: 'mobile', privacy_consent: true,
    access_token_hash: accessHash, access_token_expires_at: accessExp ?? null,
    refresh_token_hash: refreshHash ?? null, refresh_token_expires_at: refreshExp ?? null,
    created_at: now, updated_at: now,
  });
}

describe('generateTokenPair', () => {
  it('mints access + refresh tokens, storing only hashes, with future expiries', () => {
    const now = Date.now();
    const t = generateTokenPair(now);
    expect(t.accessToken).toBeTruthy();
    expect(t.refreshToken).toBeTruthy();
    expect(t.accessToken).not.toBe(t.refreshToken);
    // hashes are the SHA-256 of the plaintext, never the plaintext itself
    expect(t.accessTokenHash).toBe(hashToken(t.accessToken));
    expect(t.refreshTokenHash).toBe(hashToken(t.refreshToken));
    expect(t.accessTokenHash).not.toBe(t.accessToken);
    // access expires before refresh; both in the future
    expect(t.accessTokenExpiresAt).toBeGreaterThan(now);
    expect(t.refreshTokenExpiresAt).toBeGreaterThan(t.accessTokenExpiresAt);
  });
});

describe('authenticate enforces access-token expiry', () => {
  it('accepts a live token', async () => {
    const { token, hash } = generateAccessToken();
    await insertUser({ id: 'u_live', phone: '+85210000001', accessHash: hash, accessExp: Date.now() + 60000 });
    const req = fakeReq(token), res = fakeRes();
    let nexted = false;
    await authenticate(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.auth.userId).toBe('u_live');
  });

  it('rejects an expired token with 401 token_expired', async () => {
    const { token, hash } = generateAccessToken();
    await insertUser({ id: 'u_exp', phone: '+85210000002', accessHash: hash, accessExp: Date.now() - 1000 });
    const req = fakeReq(token), res = fakeRes();
    let nexted = false;
    await authenticate(req, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('token_expired');
  });

  it('honours a legacy NULL-expiry token (back-compat)', async () => {
    const { token, hash } = generateAccessToken();
    await insertUser({ id: 'u_legacy', phone: '+85210000003', accessHash: hash, accessExp: null });
    const req = fakeReq(token), res = fakeRes();
    let nexted = false;
    await authenticate(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });
});
