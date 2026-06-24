import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// HTTP-level tests for the report-submission contract that the web proxy flow
// depends on: web reporters cannot mark "safe", and a proxy report (which
// carries no browser location) has its location resolved from the affected
// person's own mobile report. Mounts just the reports router with a stub io.
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const createReportsRouter = require('../server/src/routes/reports');
const { DEFAULT_GOV_TOKEN, hashToken } = require('../server/src/lib/authGuard');

let server, base;
const stubIo = { to: () => ({ emit: () => {} }) };

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/reports', createReportsRouter(stubIo));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

// Reports are authenticated (C1). Default to the trusted gov token so these
// proxy-resolution tests exercise the same body they always did; pass a custom
// token (or null) to test the user-derivation / unauthenticated paths.
const post = (body, token = DEFAULT_GOV_TOKEN) => fetch(`${base}/api/reports`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;

beforeEach(async () => {
  await collection('reports').deleteMany({});
  await collection('users').deleteMany({});
});

describe('web proxy: status "safe" is forbidden', () => {
  it('rejects a web report with status=safe (422)', async () => {
    const res = await post({
      id: uuid(), name: 'Wei Chen', status: 'safe',
      user_type: 'web', reporter_name: 'Brother', reported_by: 'family',
      disaster_id: null, created_at: Date.now(),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/safe/i);
  });
});

describe('web proxy: location resolution', () => {
  it('inherits the subject\'s own mobile-report location via phone', async () => {
    // The affected person filed their own mobile report from inside the zone.
    await post({
      id: uuid(), name: 'Mei', status: 'need_help', user_type: 'mobile',
      phone: '+85261110000', lat: 22.305, lng: 114.170, created_at: Date.now(),
    });
    // A relative now files a proxy report carrying NO location, just the phone.
    const res = await post({
      id: uuid(), name: 'Mei', status: 'injured', user_type: 'web',
      reporter_name: 'Sister', phone: '+85261110000', created_at: Date.now(),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()).data;
    const doc = await collection('reports').findOne({ _id: id });
    expect(Number(doc.lat)).toBeCloseTo(22.305, 2);
    expect(Number(doc.lng)).toBeCloseTo(114.170, 2);
  });

  it('rejects a proxy report when the subject has no known location (422)', async () => {
    const res = await post({
      id: uuid(), name: 'Unknown Person', status: 'missing', user_type: 'web',
      reporter_name: 'Neighbour', phone: '+85269999999', created_at: Date.now(),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/no known location/i);
  });
});

describe('C1: report writes are authenticated + de-mass-assigned', () => {
  it('rejects an unauthenticated POST (401)', async () => {
    const res = await post(
      { id: uuid(), name: 'Anon', status: 'safe', user_type: 'mobile', lat: 22.3, lng: 114.1, created_at: Date.now() },
      null,
    );
    expect(res.status).toBe(401);
  });

  it('derives user_id from the token and ignores a forged body user_id', async () => {
    // A real user with a known access token.
    const token = 'user-token-c1';
    await collection('users').insertOne({
      _id: 'u-c1', phone: '+85255550001', name: 'Real User', role: 'citizen',
      access_token_hash: hashToken(token), access_token_expires_at: Date.now() + 3600_000,
    });
    const id = uuid();
    const res = await post(
      { id, name: 'Real User', status: 'need_help', user_type: 'mobile',
        lat: 22.3, lng: 114.1, created_at: Date.now(),
        user_id: 'victim-elsewhere', reported_for_user_id: 'someone-else' },
      token,
    );
    expect(res.status).toBe(201);
    const doc = await collection('reports').findOne({ _id: id });
    expect(doc.user_id).toBe('u-c1');                 // derived, not the forged value
    expect(doc.reported_for_user_id).toBeNull();      // stripped
    expect(doc.reported_by).toBe('self');
  });
});

describe('H5/B7: GET /stats excludes web by default', () => {
  it('omits web proxy reports unless exclude_web=false is passed', async () => {
    await post({ id: uuid(), name: 'M', status: 'need_help', user_type: 'mobile', lat: 22.3, lng: 114.1, created_at: Date.now() });
    // A web proxy report for the same person (location inherited from the mobile one).
    await post({ id: uuid(), name: 'M', status: 'injured', user_type: 'web', reporter_name: 'Sib', phone: '+85261110000', lat: 22.3, lng: 114.1, created_at: Date.now() });

    const def = await (await fetch(`${base}/api/reports/stats`)).json();
    const both = await (await fetch(`${base}/api/reports/stats?exclude_web=false`)).json();
    expect(def.data.total).toBeLessThan(both.data.total); // web excluded by default
  });
});

describe('mobile report basics', () => {
  it('requires lat/lng for a non-web report (400)', async () => {
    const res = await post({
      id: uuid(), name: 'NoLoc', status: 'safe', user_type: 'mobile', created_at: Date.now(),
    });
    expect(res.status).toBe(400);
  });

  it('relaying the same UUID is idempotent (relay_count increments, one row)', async () => {
    const id = uuid();
    const body = { id, name: 'Relay', status: 'safe', user_type: 'mobile', lat: 22.3, lng: 114.1, created_at: Date.now() };
    await post(body);
    await post(body);
    const docs = await collection('reports').find({ _id: id }).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0].relay_count).toBeGreaterThanOrEqual(1);
  });

  it('B4: a relay never overwrites the stored status/identity from the body', async () => {
    const id = uuid();
    await post({ id, name: 'Mei', status: 'need_help', user_type: 'mobile', lat: 22.3, lng: 114.1, created_at: Date.now() });
    // Same UUID, different (forged) body — relay path must only bump relay_count.
    await post({ id, name: 'Hacked', status: 'safe', user_type: 'mobile', lat: 0, lng: 0, created_at: Date.now() });
    const doc = await collection('reports').findOne({ _id: id });
    expect(doc.status).toBe('need_help'); // unchanged
    expect(doc.name).toBe('Mei');         // unchanged
    expect(doc.relay_count).toBeGreaterThanOrEqual(1);
  });
});
