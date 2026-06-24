import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// HTTP-level tests for citizen-submitted safe places and the gov/volunteer
// moderation queue: public visibility gating + the pending → approved/rejected
// state machine. Mounts just the safe-places router (with its real auth
// middleware) on a throwaway Express app.
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { hashToken } = require('../server/src/lib/authGuard');
const createSafePlacesRouter = require('../server/src/routes/safePlaces');

let server, base;
const CITIZEN_TOK = 'citizen-token';
const VOL_TOK = 'volunteer-token';

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/safe-places', createSafePlacesRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

let seq = 0;
const phone = () => `+85292${String(seq++).padStart(6, '0')}`;

async function addUser(id, role, token) {
  const now = Date.now();
  await collection('users').insertOne({
    _id: id, phone: phone(), name: `${role}-user`, role,
    access_token_hash: hashToken(token), access_token_expires_at: now + 3600_000,
    created_at: now, updated_at: now,
  });
}

async function addPlace(id, status) {
  await collection('safe_places').insertOne({
    _id: id, created_by_user_id: 'cit', name: `place-${id}`, lat: 22.30, lng: 114.17,
    status, active: true, created_at: Date.now(),
  });
}

const call = (path, tok, opts = {}) => fetch(`${base}${path}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(opts.headers || {}) },
});

beforeEach(async () => {
  await collection('safe_places').deleteMany({});
  await collection('users').deleteMany({});
  await addUser('cit', 'citizen', CITIZEN_TOK);
  await addUser('vol', 'volunteer', VOL_TOK);
});

describe('public visibility', () => {
  it('lists only APPROVED places — pending/rejected are hidden', async () => {
    await addPlace('p-approved', 'approved');
    await addPlace('p-pending', 'pending');
    await addPlace('p-rejected', 'rejected');
    const { data: safe_places } = await (await call('/api/safe-places')).json();
    const ids = safe_places.map((p) => p.id);
    expect(ids).toContain('p-approved');
    expect(ids).not.toContain('p-pending');
    expect(ids).not.toContain('p-rejected');
  });
});

describe('citizen submission', () => {
  it('requires authentication (401 without token)', async () => {
    const res = await call('/api/safe-places', null, {
      method: 'POST', body: JSON.stringify({ name: 'X', lat: 22.3, lng: 114.1 }),
    });
    expect(res.status).toBe(401);
  });

  it('creates a PENDING place — not yet publicly visible', async () => {
    const res = await call('/api/safe-places', CITIZEN_TOK, {
      method: 'POST', body: JSON.stringify({ name: 'Kowloon Park', lat: 22.30, lng: 114.17 }),
    });
    expect(res.status).toBe(201);
    const { data: safe_place } = await res.json();
    expect(safe_place.status).toBe('pending');
    // absent from the public list
    const { data: safe_places } = await (await call('/api/safe-places')).json();
    expect(safe_places.map((p) => p.id)).not.toContain(safe_place.id);
  });
});

describe('moderation queue', () => {
  it('pending queue requires gov/volunteer (403 for citizen)', async () => {
    const res = await call('/api/safe-places/pending', CITIZEN_TOK);
    expect(res.status).toBe(403);
  });

  it('volunteer sees the pending queue', async () => {
    await addPlace('p1', 'pending');
    const res = await call('/api/safe-places/pending', VOL_TOK);
    expect(res.status).toBe(200);
    const { data: safe_places } = await res.json();
    expect(safe_places.map((p) => p.id)).toContain('p1');
  });

  it('approving a pending place makes it public', async () => {
    await addPlace('p2', 'pending');
    const res = await call('/api/safe-places/p2/status', VOL_TOK, {
      method: 'PUT', body: JSON.stringify({ status: 'approved' }),
    });
    expect(res.status).toBe(200);
    const { data: safe_places } = await (await call('/api/safe-places')).json();
    expect(safe_places.map((p) => p.id)).toContain('p2');
  });

  it('rejecting keeps it hidden and out of the queue', async () => {
    await addPlace('p3', 'pending');
    await call('/api/safe-places/p3/status', VOL_TOK, {
      method: 'PUT', body: JSON.stringify({ status: 'rejected' }),
    });
    const pub = await (await call('/api/safe-places')).json();
    const q = await (await call('/api/safe-places/pending', VOL_TOK)).json();
    expect(pub.data.map((p) => p.id)).not.toContain('p3');
    expect(q.data.map((p) => p.id)).not.toContain('p3');
  });

  it('re-reviewing an already-decided place returns 404', async () => {
    await addPlace('p4', 'approved');
    const res = await call('/api/safe-places/p4/status', VOL_TOK, {
      method: 'PUT', body: JSON.stringify({ status: 'rejected' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid status value (400)', async () => {
    await addPlace('p5', 'pending');
    const res = await call('/api/safe-places/p5/status', VOL_TOK, {
      method: 'PUT', body: JSON.stringify({ status: 'maybe' }),
    });
    expect(res.status).toBe(400);
  });
});
