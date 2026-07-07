import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// P2 — HTTP tests for the shelter directory: public read of ACTIVE shelters,
// gov/volunteer-gated writes, radius + source filtering, partial update, and
// soft-delete (deactivate — never removed). Structured like safePlaces.test.js;
// shelters differ in that they are active on creation (no moderation queue).
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { hashToken, DEFAULT_GOV_TOKEN } = require('../server/src/lib/authGuard');
const createSheltersRouter = require('../server/src/routes/shelters');

let server, base;
const CITIZEN_TOK = 'shelter-citizen-tok';
const VOL_TOK = 'shelter-volunteer-tok';

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/shelters', createSheltersRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  // The shelter routes audit via fire-and-forget logAudit(); let any in-flight
  // write flush before the DB closes so it doesn't log a spurious error.
  await new Promise((r) => setTimeout(r, 150));
  await closeDb();
});

let seq = 0;
const phone = () => `+85293${String(seq++).padStart(6, '0')}`;

async function addUser(id, role, token) {
  const now = Date.now();
  await collection('users').insertOne({
    _id: id, phone: phone(), name: `${role}-user`, role,
    access_token_hash: hashToken(token), access_token_expires_at: now + 3600_000,
    created_at: now, updated_at: now,
  });
}

async function seedShelter(id, over = {}) {
  const now = Date.now();
  await collection('shelters').insertOne({
    _id: id, name: `shelter-${id}`, type: 'shelter', source: 'government',
    lat: 22.30, lng: 114.17, capacity: 100, current_count: 0,
    disaster_id: null, active: true, created_at: now, updated_at: now, ...over,
  });
}

const call = (path, tok, opts = {}) => fetch(`${base}${path}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(opts.headers || {}) },
});

beforeEach(async () => {
  await collection('shelters').deleteMany({});
  await collection('users').deleteMany({});
  await addUser('cit', 'citizen', CITIZEN_TOK);
  await addUser('vol', 'volunteer', VOL_TOK);
});

describe('public read', () => {
  it('lists only ACTIVE shelters', async () => {
    await seedShelter('s-active', { active: true });
    await seedShelter('s-inactive', { active: false });
    const { data } = await (await call('/api/shelters')).json();
    const ids = data.map((s) => s.id);
    expect(ids).toContain('s-active');
    expect(ids).not.toContain('s-inactive');
  });

  it('returns a single shelter by id, 404 for unknown', async () => {
    await seedShelter('s1');
    const ok = await call('/api/shelters/s1');
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.id).toBe('s1');
    expect((await call('/api/shelters/nope')).status).toBe(404);
  });

  it('filters by source', async () => {
    await seedShelter('gov1', { source: 'government' });
    await seedShelter('vol1', { source: 'volunteer' });
    const { data } = await (await call('/api/shelters?source=volunteer')).json();
    expect(data.map((s) => s.id)).toEqual(['vol1']);
  });

  it('filters by radius — excludes far shelters', async () => {
    await seedShelter('near', { lat: 22.30, lng: 114.17 });
    await seedShelter('far', { lat: 1.35, lng: 103.82 }); // Singapore, ~2500km
    const { data } = await (await call('/api/shelters?lat=22.30&lng=114.17&radius=25')).json();
    const ids = data.map((s) => s.id);
    expect(ids).toContain('near');
    expect(ids).not.toContain('far');
  });
});

describe('write access — gov token or volunteer/government role only', () => {
  const body = JSON.stringify({ name: 'Kowloon Park Shelter', lat: 22.30, lng: 114.17 });

  it('rejects an unauthenticated create (401)', async () => {
    expect((await call('/api/shelters', null, { method: 'POST', body })).status).toBe(401);
  });

  it('rejects a citizen (403)', async () => {
    expect((await call('/api/shelters', CITIZEN_TOK, { method: 'POST', body })).status).toBe(403);
  });

  it('lets a volunteer create — active + publicly listed immediately', async () => {
    const res = await call('/api/shelters', VOL_TOK, { method: 'POST', body });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.active).toBe(true);
    const list = await (await call('/api/shelters')).json();
    expect(list.data.map((s) => s.id)).toContain(data.id);
  });

  it('lets the gov token create', async () => {
    expect((await call('/api/shelters', DEFAULT_GOV_TOKEN, { method: 'POST', body })).status).toBe(201);
  });
});

describe('update + soft-delete', () => {
  it('updates provided fields only', async () => {
    await seedShelter('s1', { current_count: 0, name: 'Old Name' });
    const res = await call('/api/shelters/s1', VOL_TOK, {
      method: 'PUT', body: JSON.stringify({ current_count: 42 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.current_count).toBe(42);
    expect(data.name).toBe('Old Name'); // untouched
  });

  it('rejects an invalid update body (400)', async () => {
    await seedShelter('s1');
    const res = await call('/api/shelters/s1', VOL_TOK, {
      method: 'PUT', body: JSON.stringify({ capacity: -5 }), // must be positive
    });
    expect(res.status).toBe(400);
  });

  it('404 when updating a missing shelter', async () => {
    const res = await call('/api/shelters/ghost', VOL_TOK, {
      method: 'PUT', body: JSON.stringify({ current_count: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('soft-deletes: gone from the public list but still fetchable, and idempotent', async () => {
    await seedShelter('s1');
    expect((await call('/api/shelters/s1', VOL_TOK, { method: 'DELETE' })).status).toBe(200);
    // Absent from the active list...
    const list = await (await call('/api/shelters')).json();
    expect(list.data.map((s) => s.id)).not.toContain('s1');
    // ...but the record persists, now inactive.
    const detail = await (await call('/api/shelters/s1')).json();
    expect(detail.data.active).toBe(false);
    // Deactivating again is harmless.
    expect((await call('/api/shelters/s1', VOL_TOK, { method: 'DELETE' })).status).toBe(200);
  });
});
