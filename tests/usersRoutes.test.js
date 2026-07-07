import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// P2 — the citizen user endpoints the suite had not driven: phone-only login,
// profile read (owner/gov, HKID masked), profile update, PDPO erasure over HTTP
// (the store cascade was tested; the authenticated own()-guarded route was not),
// and anonymous/associated device registration (the location-capture endpoint
// that feeds all radius targeting).
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { hashToken, DEFAULT_GOV_TOKEN } = require('../server/src/lib/authGuard');
const createUsersRouter = require('../server/src/routes/users');
const createDevicesRouter = require('../server/src/routes/devices');

let server, base;

beforeAll(async () => {
  await setup();
  delete process.env.OTP_ENABLED; // login/profile must run on the frictionless path
  const app = express();
  app.use(express.json());
  app.use('/api/users', createUsersRouter());
  app.use('/api/devices', createDevicesRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

async function seedUser({ id, phone, token, personal_id = null, role = 'citizen', name = 'Seed User' }) {
  const now = Date.now();
  const doc = {
    _id: id, phone, name, gender: 'female', role, user_type: 'mobile', privacy_consent: true,
    access_token_hash: hashToken(token), access_token_expires_at: now + 3600_000,
    created_at: now, updated_at: now,
  };
  if (personal_id != null) doc.personal_id = personal_id;
  await collection('users').insertOne(doc);
}

const call = (path, tok, opts = {}) => fetch(`${base}${path}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(opts.headers || {}) },
});
const profilePath = (phone) => `/api/users/${encodeURIComponent(phone)}/profile`;

beforeEach(async () => {
  await collection('users').deleteMany({});
  await collection('reports').deleteMany({});
  await collection('device_push_tokens').deleteMany({});
  await collection('account_links').deleteMany({});
});

describe('POST /login (phone-only)', () => {
  it('logs in an existing account and returns a token pair', async () => {
    await seedUser({ id: 'u1', phone: '+85294000001', token: 'u1-tok' });
    const res = await call('/api/users/login', null, { method: 'POST', body: JSON.stringify({ phone: '94000001' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.user.phone).toBe('+85294000001');
  });

  it('404s for a phone with no account', async () => {
    const res = await call('/api/users/login', null, { method: 'POST', body: JSON.stringify({ phone: '96000000' }) });
    expect(res.status).toBe(404);
  });

  it('never returns the HKID in full', async () => {
    await seedUser({ id: 'u2', phone: '+85294000002', token: 'u2-tok', personal_id: 'A1234567' });
    const res = await call('/api/users/login', null, { method: 'POST', body: JSON.stringify({ phone: '94000002' }) });
    const { user } = await res.json();
    expect(user.personal_id).not.toBe('A1234567');
    expect(user.personal_id.startsWith('A')).toBe(true);
    expect(user.personal_id.endsWith('(7)')).toBe(true);
  });
});

describe('GET /:phone/profile', () => {
  beforeEach(async () => {
    await seedUser({ id: 'owner', phone: '+85294001000', token: 'owner-tok', personal_id: 'A1234567' });
    await seedUser({ id: 'other', phone: '+85294001999', token: 'other-tok' });
  });

  it('lets the owner read their own profile — HKID masked, no secret fields', async () => {
    const res = await call(profilePath('+85294001000'), 'owner-tok');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.phone).toBe('+85294001000');
    expect(data.personal_id).not.toBe('A1234567');   // masked
    expect(data.access_token_hash).toBeUndefined();   // never leaked
    expect(data.password_hash).toBeUndefined();
  });

  it("forbids reading another user's profile (403)", async () => {
    const res = await call(profilePath('+85294001000'), 'other-tok');
    expect(res.status).toBe(403);
  });

  it('lets a gov token read any profile (200)', async () => {
    const res = await call(profilePath('+85294001000'), DEFAULT_GOV_TOKEN);
    expect(res.status).toBe(200);
  });

  it('requires authentication (401)', async () => {
    expect((await call(profilePath('+85294001000'), null)).status).toBe(401);
  });

  it('404s for an unknown phone (as gov)', async () => {
    expect((await call(profilePath('+85290000000'), DEFAULT_GOV_TOKEN)).status).toBe(404);
  });
});

describe('PATCH /:id (profile update)', () => {
  beforeEach(async () => {
    await seedUser({ id: 'owner', phone: '+85294002000', token: 'owner-tok' });
    await seedUser({ id: 'other', phone: '+85294002999', token: 'other-tok' });
  });

  it('updates only the provided fields and never leaks hashes', async () => {
    const res = await call('/api/users/owner', 'owner-tok', { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.name).toBe('Renamed');
    expect(data.access_token_hash).toBeUndefined();
  });

  it("cannot update another user's profile (403)", async () => {
    const res = await call('/api/users/owner', 'other-tok', { method: 'PATCH', body: JSON.stringify({ name: 'Hax' }) });
    expect(res.status).toBe(403);
  });

  it('requires authentication (401)', async () => {
    expect((await call('/api/users/owner', null, { method: 'PATCH', body: JSON.stringify({ name: 'X' }) })).status).toBe(401);
  });

  it('rejects an invalid body (400)', async () => {
    const res = await call('/api/users/owner', 'owner-tok', { method: 'PATCH', body: JSON.stringify({ email: 'not-an-email' }) });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /:id (PDPO erasure over HTTP)', () => {
  it('erases the account, scrubs report PII, and cascades devices + links', async () => {
    await seedUser({ id: 'erase-me', phone: '+85294003000', token: 'erase-tok', personal_id: 'A1234567' });
    const now = Date.now();
    await collection('reports').insertOne({
      _id: 'rep', name: 'Real Name', name_lower: 'real name', status: 'safe', lat: 22.3, lng: 114.1,
      phone: '+85294003000', personal_id: 'A1234567', medical_notes: 'note', user_id: 'erase-me',
      user_type: 'mobile', created_at: now, updated_at: now,
    });
    await collection('device_push_tokens').insertOne({ _id: 'd', token: 'tk', platform: 'ios', user_id: 'erase-me' });
    await collection('account_links').insertOne({ _id: 'l', user_a_id: 'erase-me', user_b_id: 'x', status: 'confirmed', created_at: now });

    const res = await call('/api/users/erase-me', 'erase-tok', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.deleted).toBe(1);

    expect(await collection('users').findOne({ _id: 'erase-me' })).toBeNull();
    const rep = await collection('reports').findOne({ _id: 'rep' });
    expect(rep.name).toBe('Erased');       // report kept for aggregate counts, PII scrubbed
    expect(rep.phone).toBeNull();
    expect(rep.personal_id).toBeNull();
    expect(rep.user_id).toBeNull();
    expect(await collection('device_push_tokens').findOne({ _id: 'd' })).toBeNull(); // cascaded
    expect(await collection('account_links').findOne({ _id: 'l' })).toBeNull();      // cascaded
  });

  it("cannot erase another user's account (403)", async () => {
    await seedUser({ id: 'me', phone: '+85294003100', token: 'me-tok' });
    await seedUser({ id: 'victim', phone: '+85294003200', token: 'victim-tok' });
    const res = await call('/api/users/victim', 'me-tok', { method: 'DELETE' });
    expect(res.status).toBe(403);
    expect(await collection('users').findOne({ _id: 'victim' })).toBeTruthy();
  });

  it('requires authentication (401)', async () => {
    await seedUser({ id: 'u', phone: '+85294003300', token: 'u-tok' });
    expect((await call('/api/users/u', null, { method: 'DELETE' })).status).toBe(401);
  });
});

describe('POST /api/devices/register', () => {
  const body = (over = {}) => JSON.stringify({ token: 'push-tok-1', platform: 'ios', lat: 22.30, lng: 114.17, ...over });

  it('registers an ANONYMOUS device (no auth) with a null user_id', async () => {
    const res = await call('/api/devices/register', null, { method: 'POST', body: body() });
    expect(res.status).toBe(201);
    const doc = await collection('device_push_tokens').findOne({ token: 'push-tok-1' });
    expect(doc.user_id).toBeNull();
    expect(doc.platform).toBe('ios');
    expect(doc.lat).toBeCloseTo(22.30);
  });

  it('associates the handle with the user when a Bearer token is present', async () => {
    await seedUser({ id: 'dev-owner', phone: '+85294004000', token: 'dev-owner-tok' });
    const res = await call('/api/devices/register', 'dev-owner-tok', { method: 'POST', body: body({ token: 'push-tok-2' }) });
    expect(res.status).toBe(201);
    const doc = await collection('device_push_tokens').findOne({ token: 'push-tok-2' });
    expect(doc.user_id).toBe('dev-owner');
  });

  it('upserts on re-registration — one row, refreshed location', async () => {
    await call('/api/devices/register', null, { method: 'POST', body: body({ lat: 22.30, lng: 114.17 }) });
    await call('/api/devices/register', null, { method: 'POST', body: body({ lat: 22.40, lng: 114.20 }) });
    const docs = await collection('device_push_tokens').find({ token: 'push-tok-1' }).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].lat).toBeCloseTo(22.40); // refreshed
  });

  it('rejects an invalid platform (400)', async () => {
    const res = await call('/api/devices/register', null, { method: 'POST', body: body({ platform: 'blackberry' }) });
    expect(res.status).toBe(400);
  });
});

describe('A3 — duplicate HKID on a different phone → 409', () => {
  const reg = (phone, personal_id) => call('/api/users/register', null, {
    method: 'POST',
    body: JSON.stringify({ phone, name: 'Dup Tester', gender: 'female', personal_id, privacy_consent: true }),
  });
  it('rejects a second registration reusing another account\'s HKID', async () => {
    expect((await reg('90007001', 'A1234563')).status).toBe(201);
    const dup = await reg('90007002', 'A1234563'); // same HKID, different phone
    expect(dup.status).toBe(409);
  });
});
