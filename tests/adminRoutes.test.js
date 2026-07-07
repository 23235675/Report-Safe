import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

// HTTP-level tests for the super-admin REST API (/api/admin/*): the dynamic
// filter/sort builders AND the deploy-hardening guards (self-lockout,
// passwordless super_admin, enum validation). We mount JUST the admin router on
// a throwaway Express app and hit it with Node's built-in fetch — no supertest
// dependency, no full bootstrap (Redis, timers, sockets).
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { hashToken, hashPassword } = require('../server/src/lib/authGuard');
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

// ── P2: the remaining admin sub-routers + the audit-write guarantee ──────────
// Guardrail #6 says "privileged actions are audited" — assert an audit_logs row
// is written for each mutation (the sub-routers `await auditLog(...)`, so it is
// deterministic). Also covers disasters/links/devices CRUD, /stats, /audit and
// /login, which the suite above did not touch.
const auditCount = (action, entity, entity_id) =>
  collection('audit_logs').countDocuments({ action, entity, entity_id });

describe('admin disasters CRUD + audit', () => {
  it('creates, lists, updates and deletes a disaster, auditing each mutation', async () => {
    const created = await authed('/api/admin/disasters', {
      method: 'POST',
      body: JSON.stringify({ type: 'flood', severity: 3, lat: 22.3, lng: 114.17, radius_km: 10 }),
    });
    expect(created.status).toBe(201);
    const id = (await created.json()).data.id;
    expect(await auditCount('create', 'disasters', id)).toBe(1);

    const list = await (await authed('/api/admin/disasters')).json();
    expect(list.data.some((d) => d.id === id)).toBe(true);

    const upd = await authed(`/api/admin/disasters/${id}`, {
      method: 'PUT', body: JSON.stringify({ active: false }),
    });
    expect(upd.status).toBe(200);
    expect((await upd.json()).data.active).toBe(false);
    expect(await auditCount('update', 'disasters', id)).toBe(1);

    // DELETE also nulls reports.disaster_id (emulated FK ON DELETE SET NULL).
    await collection('reports').insertOne({
      _id: 'r-linked', name: 'x', name_lower: 'x', status: 'safe', lat: 22.3, lng: 114.1,
      user_type: 'mobile', disaster_id: id, created_at: Date.now(), updated_at: Date.now(),
    });
    const del = await authed(`/api/admin/disasters/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await collection('reports').findOne({ _id: 'r-linked' })).disaster_id).toBeNull();
    expect(await auditCount('delete', 'disasters', id)).toBe(1);
  });

  it('404 on updating a missing disaster', async () => {
    const res = await authed('/api/admin/disasters/ghost', { method: 'PUT', body: JSON.stringify({ active: false }) });
    expect(res.status).toBe(404);
  });
});

describe('admin links CRUD + audit', () => {
  beforeEach(async () => {
    await addUser('la', { name: 'Link A' });
    await addUser('lb', { name: 'Link B' });
    await collection('account_links').insertOne({
      _id: 'lk-1', user_a_id: 'la', user_b_id: 'lb', status: 'pending', confirmed_at: null, created_at: Date.now(),
    });
  });

  it('lists links joined to both parties', async () => {
    const { data } = await (await authed('/api/admin/links')).json();
    const row = data.find((l) => l.id === 'lk-1');
    expect(row).toBeTruthy();
    expect(row.user_a_name).toBe('Link A');
    expect(row.user_b_name).toBe('Link B');
  });

  it('updates a link status (confirm) and audits it', async () => {
    const res = await authed('/api/admin/links/lk-1', { method: 'PUT', body: JSON.stringify({ status: 'confirmed' }) });
    expect(res.status).toBe(200);
    const doc = await collection('account_links').findOne({ _id: 'lk-1' });
    expect(doc.status).toBe('confirmed');
    expect(doc.confirmed_at).toBeTruthy();
    expect(await auditCount('update', 'account_links', 'lk-1')).toBe(1);
  });

  it('rejects an invalid status (400)', async () => {
    const res = await authed('/api/admin/links/lk-1', { method: 'PUT', body: JSON.stringify({ status: 'friends' }) });
    expect(res.status).toBe(400);
  });

  it('deletes a link and audits it, 404 for missing', async () => {
    expect((await authed('/api/admin/links/lk-1', { method: 'DELETE' })).status).toBe(200);
    expect(await collection('account_links').findOne({ _id: 'lk-1' })).toBeNull();
    expect(await auditCount('delete', 'account_links', 'lk-1')).toBe(1);
    expect((await authed('/api/admin/links/lk-1', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('admin devices CRUD + audit', () => {
  beforeEach(async () => {
    await collection('device_push_tokens').insertOne({
      _id: 'dv-1', token: 'push-token-abcdef', platform: 'ios', user_id: null, lat: 22.3, lng: 114.1,
      created_at: Date.now(), updated_at: Date.now(),
    });
  });

  it('lists devices with paging meta', async () => {
    const body = await (await authed('/api/admin/devices')).json();
    expect(body.data.some((d) => d.id === 'dv-1')).toBe(true);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('deletes a device and audits it, 404 for missing', async () => {
    expect((await authed('/api/admin/devices/dv-1', { method: 'DELETE' })).status).toBe(200);
    expect(await collection('device_push_tokens').findOne({ _id: 'dv-1' })).toBeNull();
    expect(await auditCount('delete', 'device_push_tokens', 'dv-1')).toBe(1);
    expect((await authed('/api/admin/devices/ghost', { method: 'DELETE' })).status).toBe(404);
  });
});

describe('admin stats + audit trail', () => {
  it('GET /stats returns the aggregate shape', async () => {
    const { data } = await (await authed('/api/admin/stats')).json();
    expect(data.users.total).toBeGreaterThanOrEqual(1); // at least the seeded admin
    expect(data).toHaveProperty('reports');
    expect(data).toHaveProperty('disasters');
    expect(data).toHaveProperty('links');
  });

  it('GET /audit surfaces a freshly written audit row', async () => {
    const created = await authed('/api/admin/disasters', {
      method: 'POST', body: JSON.stringify({ type: 'fire', lat: 22.3, lng: 114.17, radius_km: 5 }),
    });
    const id = (await created.json()).data.id;
    const { data } = await (await authed('/api/admin/audit?entity=disasters')).json();
    expect(data.some((a) => a.entity_id === id && a.action === 'create')).toBe(true);
  });
});

describe('admin login', () => {
  it('issues tokens for correct credentials and audits the login, 401 for a wrong password', async () => {
    const admin = await collection('users').findOne({ _id: ADMIN_ID });
    const ok = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: admin.phone, password: 'correct-horse' }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.access_token).toBeTruthy();
    expect(body.user.role).toBe('super_admin');
    expect(await auditCount('login', 'users', ADMIN_ID)).toBe(1);

    const bad = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: admin.phone, password: 'wrong' }),
    });
    expect(bad.status).toBe(401);
  });

  it('400 when phone or password is missing', async () => {
    const res = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '123' }),
    });
    expect(res.status).toBe(400);
  });

  it('A14 — accepts both bare 8-digit and full +852 phone formats', async () => {
    const admin = await collection('users').findOne({ _id: ADMIN_ID });
    const login = (phone) => fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: 'correct-horse' }),
    });
    expect((await login(admin.phone.slice(-8))).status).toBe(200); // bare 8 digits
    expect((await login(admin.phone)).status).toBe(200);           // full +852
  });
});

describe('M9 — admin IP allowlist', () => {
  afterEach(() => { delete process.env.ADMIN_IP_ALLOWLIST; });

  it('refuses a request from a non-allowlisted address (403), even with a valid token', async () => {
    process.env.ADMIN_IP_ALLOWLIST = '203.0.113.1'; // TEST-NET-3, never the loopback
    expect((await authed('/api/admin/users')).status).toBe(403);
  });

  it('is a no-op when unset (request allowed)', async () => {
    expect((await authed('/api/admin/users')).status).toBe(200);
  });
});

describe('M10 — HKID unmasked in the admin console only', () => {
  it('returns the full personal_id in the admin user list', async () => {
    await addUser('hkid-user', { role: 'citizen', personal_id: 'A1234563' });
    const { data } = await (await authed('/api/admin/users')).json();
    const row = data.find((u) => u.id === 'hkid-user');
    expect(row.personal_id).toBe('A1234563'); // full — masked everywhere else
  });
});
