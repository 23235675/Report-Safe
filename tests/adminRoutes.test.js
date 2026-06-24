import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// HTTP-level tests for the super-admin REST API (/api/admin/*): the dynamic
// filter/sort builders AND the deploy-hardening guards (self-lockout,
// passwordless super_admin, enum validation). We mount JUST the admin router on
// a throwaway Express app and hit it with Node's built-in fetch — no supertest
// dependency, no full bootstrap (Redis, timers, sockets).
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { hashToken, hashPassword, generateTokenPair } = require('../server/src/lib/authGuard');
const createAdminRouter = require('../server/src/routes/admin');

let server, base;
const ADMIN_TOKEN = 'test-admin-access-token';
const ADMIN_ID = 'admin-1';

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createAdminRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

let seq = 0;
const phone = () => `+85291${String(seq++).padStart(6, '0')}`;

async function addUser(id, over = {}) {
  const f = {
    phone: phone(), name: 'User', email: null, personal_id: null,
    role: 'citizen', user_type: 'mobile', privacy_consent: false,
    password_hash: null, created_at: Date.now(), ...over,
  };
  const doc = {
    _id: id, phone: f.phone, name: f.name, email: f.email, role: f.role,
    user_type: f.user_type, privacy_consent: f.privacy_consent,
    password_hash: f.password_hash, created_at: f.created_at, updated_at: f.created_at,
  };
  // personal_id is OMITTED when null so the sparse-unique index skips it.
  if (f.personal_id != null) doc.personal_id = f.personal_id;
  await collection('users').insertOne(doc);
}

async function seedAdminUser() {
  await addUser(ADMIN_ID, {
    name: 'Root Admin', role: 'super_admin',
    password_hash: hashPassword('correct-horse'),
  });
  await collection('users').updateOne(
    { _id: ADMIN_ID },
    { $set: { access_token_hash: hashToken(ADMIN_TOKEN), access_token_expires_at: Date.now() + 3600_000 } },
  );
}

const authed = (path, opts = {}) => fetch(`${base}${path}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}`, ...(opts.headers || {}) },
});

beforeEach(async () => {
  await collection('audit_logs').deleteMany({});
  await collection('reports').deleteMany({});
  await collection('account_links').deleteMany({});
  await collection('device_push_tokens').deleteMany({});
  await collection('disasters').deleteMany({});
  await collection('users').deleteMany({});
  await seedAdminUser();
});

describe('auth gate', () => {
  it('rejects requests with no token (401)', async () => {
    const res = await fetch(`${base}/api/admin/users`);
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin token (403)', async () => {
    await addUser('plain', { role: 'citizen' });
    await collection('users').updateOne({ _id: 'plain' },
      { $set: { access_token_hash: hashToken('plain-tok'), access_token_expires_at: Date.now() + 3600_000 } });
    const res = await fetch(`${base}/api/admin/users`, { headers: { Authorization: 'Bearer plain-tok' } });
    expect(res.status).toBe(403);
  });
});

describe('GET /users — filters', () => {
  beforeEach(async () => {
    await addUser('u-vol', { role: 'volunteer', email: 'v@x.com', privacy_consent: true });
    await addUser('u-gov', { role: 'government', email: null, privacy_consent: false });
    await addUser('u-cit', { role: 'citizen', user_type: 'web', email: 'c@x.com', privacy_consent: true });
  });

  it('filters by role', async () => {
    const { data: rows } = await (await authed('/api/admin/users?role=volunteer')).json();
    expect(rows.every((r) => r.role === 'volunteer')).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it('filters by consent=true', async () => {
    const { data: rows } = await (await authed('/api/admin/users?consent=true')).json();
    expect(rows.every((r) => r.privacy_consent === true)).toBe(true);
  });

  it('filters by has_email=false', async () => {
    const { data: rows } = await (await authed('/api/admin/users?has_email=false')).json();
    expect(rows.some((r) => r.id === 'u-gov')).toBe(true);
    expect(rows.every((r) => !r.email)).toBe(true);
  });

  it('combines filters and search safely (parameterized)', async () => {
    const res = await authed(`/api/admin/users?role=citizen&q=${encodeURIComponent("'; DROP TABLE users; --")}`);
    expect(res.status).toBe(200);
    const { data: rows } = await res.json();
    expect(rows).toHaveLength(0); // no match, no injection
    // table still intact:
    expect((await (await authed('/api/admin/users')).json()).data.length).toBeGreaterThan(0);
  });
});

describe('M7: cursor pagination on /users', () => {
  it('?after pages without skip and returns next_cursor', async () => {
    for (let i = 0; i < 5; i++) await addUser(`cu-${i}`, { name: `Cursor ${i}` });
    const page1 = await (await authed('/api/admin/users?after=&limit=3')).json();
    expect(page1.data).toHaveLength(3);
    expect(page1.meta.next_cursor).toBeTruthy();
    const page2 = await (await authed(`/api/admin/users?limit=3&after=${page1.meta.next_cursor}`)).json();
    // No overlap between the two pages.
    const ids1 = new Set(page1.data.map((r) => r.id));
    expect(page2.data.every((r) => !ids1.has(r.id))).toBe(true);
  });
});

describe('GET /reports — urgency sort + filters', () => {
  beforeEach(async () => {
    const mk = (id, status) => collection('reports').insertOne({
      _id: id, name: id, name_lower: String(id).toLowerCase(), status,
      lat: 22.3, lng: 114.1, user_type: 'mobile', disaster_id: null,
      created_at: Date.now(), updated_at: Date.now(),
    });
    await mk('r-safe', 'safe');
    await mk('r-need', 'need_help');
    await mk('r-inj', 'injured');
  });

  it('defaults to urgency order — need_help before injured before safe', async () => {
    const { data: rows } = await (await authed('/api/admin/reports')).json();
    const order = rows.map((r) => r.status);
    expect(order.indexOf('need_help')).toBeLessThan(order.indexOf('injured'));
    expect(order.indexOf('injured')).toBeLessThan(order.indexOf('safe'));
  });

  it('filters by status', async () => {
    const { data: rows } = await (await authed('/api/admin/reports?status=need_help')).json();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('need_help');
  });

  it('disaster_id=__none__ returns only unlinked reports', async () => {
    const { data: rows } = await (await authed('/api/admin/reports?disaster_id=__none__')).json();
    expect(rows.every((r) => r.disaster_id === null)).toBe(true);
  });
});

describe('finding #1 — self-lockout guard on PUT /users/:id', () => {
  it('blocks an admin from demoting their OWN super_admin role', async () => {
    const res = await authed(`/api/admin/users/${ADMIN_ID}`, {
      method: 'PUT', body: JSON.stringify({ role: 'citizen' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/your own super_admin/i);
    // role unchanged in DB
    const doc = await collection('users').findOne({ _id: ADMIN_ID });
    expect(doc.role).toBe('super_admin');
  });

  it('still lets an admin edit their own non-role fields', async () => {
    const res = await authed(`/api/admin/users/${ADMIN_ID}`, {
      method: 'PUT', body: JSON.stringify({ name: 'Renamed Admin' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('finding #2 — passwordless super_admin guard', () => {
  it('blocks promoting a passwordless user to super_admin via PUT', async () => {
    await addUser('promote-me', { role: 'citizen', password_hash: null });
    const res = await authed('/api/admin/users/promote-me', {
      method: 'PUT', body: JSON.stringify({ role: 'super_admin' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/password is required/i);
  });

  it('allows promotion when a password is supplied in the same request', async () => {
    await addUser('promote-ok', { role: 'citizen' });
    const res = await authed('/api/admin/users/promote-ok', {
      method: 'PUT', body: JSON.stringify({ role: 'super_admin', password: 'new-secret-pw' }),
    });
    expect(res.status).toBe(200);
  });

  it('POST rejects a super_admin with no password', async () => {
    const res = await authed('/api/admin/users', {
      method: 'POST', body: JSON.stringify({ phone: phone(), name: 'X', role: 'super_admin' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('finding #4 — enum validation returns 400, not 500', () => {
  it('rejects an unknown role on POST', async () => {
    const res = await authed('/api/admin/users', {
      method: 'POST', body: JSON.stringify({ phone: phone(), name: 'X', role: 'wizard' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/role must be one of/i);
  });

  it('rejects an unknown report status on PUT', async () => {
    await collection('reports').insertOne({
      _id: 'rr', name: 'rr', name_lower: 'rr', status: 'safe', lat: 22.3, lng: 114.1,
      user_type: 'mobile', disaster_id: null, created_at: Date.now(), updated_at: Date.now(),
    });
    const res = await authed('/api/admin/reports/rr', {
      method: 'PUT', body: JSON.stringify({ status: 'teleported' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/status must be one of/i);
  });

  it('self-delete is still blocked (regression of existing guard)', async () => {
    const res = await authed(`/api/admin/users/${ADMIN_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});
