import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// P2 — the reports READ routes not previously hit at the HTTP layer: the public
// /search (coarse+masked) and /people roster, and the gov-gated /rescue triage
// view (full PII). The underlying store logic is covered in reportStore.test.js;
// this exercises the route wrappers — auth guard + query-schema validation.
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { DEFAULT_GOV_TOKEN } = require('../server/src/lib/authGuard');
const createReportsRouter = require('../server/src/routes/reports');

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

const call = (path, tok) => fetch(`${base}${path}`, {
  headers: tok ? { Authorization: `Bearer ${tok}` } : {},
});

beforeEach(async () => {
  await collection('reports').deleteMany({});
  await collection('users').deleteMany({});
  const now = Date.now();
  await collection('users').insertOne({
    _id: 'u1', phone: '+85291234567', name: 'Mei Wong', role: 'citizen',
    privacy_consent: true, created_at: now, updated_at: now,
  });
  await collection('reports').insertOne({
    _id: 'r1', name: 'Mei Wong', name_lower: 'mei wong', status: 'need_help',
    lat: 22.30, lng: 114.17, phone: '+85291234567', personal_id: 'A1234563',
    medical_notes: 'trapped', user_id: 'u1', user_type: 'mobile', created_at: now, updated_at: now,
  });
});

describe('GET /search (public — coarse + masked)', () => {
  it('finds a person by name prefix without leaking full PII', async () => {
    const res = await call('/api/reports/search?q=Mei');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const row = data.find((p) => p.name === 'Mei Wong');
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty('personal_id'); // never on the public tier
    expect(row.phone_masked).toMatch(/4567$/);      // last 4 only
  });

  it('rejects an out-of-range query param (400 — limit > 100)', async () => {
    const res = await call('/api/reports/search?q=Mei&limit=999');
    expect(res.status).toBe(400);
  });
});

describe('GET /people (public roster)', () => {
  it('returns rows + paging meta', async () => {
    const res = await call('/api/reports/people');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.total).toBe('number');
  });

  it('passes a status filter through to meta', async () => {
    const body = await (await call('/api/reports/people?status=need_help')).json();
    expect(body.meta.status).toBe('need_help');
  });
});

describe('GET /rescue (gov-only triage — full PII)', () => {
  it('rejects without the gov token (401)', async () => {
    expect((await call('/api/reports/rescue?lat=22.30&lng=114.17&radius=50', null)).status).toBe(401);
  });

  it('returns in-radius reports with full PII to a gov token', async () => {
    const res = await call('/api/reports/rescue?lat=22.30&lng=114.17&radius=50', DEFAULT_GOV_TOKEN);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const row = data.find((r) => r.id === 'r1');
    expect(row).toBeTruthy();
    expect(row.personal_id).toBe('A1234563'); // rescue tier sees the HKID
  });

  it('rejects a query missing required lat/lng (400)', async () => {
    const res = await call('/api/reports/rescue?lng=114.17&radius=50', DEFAULT_GOV_TOKEN);
    expect(res.status).toBe(400);
  });
});
