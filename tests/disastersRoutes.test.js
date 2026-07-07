import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// P2 — the disasters ROUTE wrappers (the engine dedup/activate is covered in
// triggerEngine/phase3; here we hit the HTTP layer): public active-list, the
// gov-gated manual trigger (auth + schema + suppress-duplicate), over HTTP.
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { DEFAULT_GOV_TOKEN } = require('../server/src/lib/authGuard');
const createDisastersRouter = require('../server/src/routes/disasters');

let server, base;
const stubIo = { to: () => ({ emit: () => {} }), fetchSockets: async () => [] };

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/disasters', createDisastersRouter(stubIo));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => setTimeout(r, 150)); // let fire-and-forget logAudit flush
  await closeDb();
});

beforeEach(async () => {
  await collection('disasters').deleteMany({});
});

const gov = (path, method = 'GET', body) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEFAULT_GOV_TOKEN}` },
  body: body ? JSON.stringify(body) : undefined,
});

describe('GET /api/disasters', () => {
  it('lists ACTIVE disasters only', async () => {
    const now = Date.now();
    await collection('disasters').insertOne({ _id: 'd-on', type: 'flood', active: true, lat: 22.3, lng: 114.1, radius_km: 10, started_at: now });
    await collection('disasters').insertOne({ _id: 'd-off', type: 'typhoon', active: false, lat: 22.3, lng: 114.1, radius_km: 10, started_at: now });
    const res = await fetch(`${base}/api/disasters`);
    expect(res.status).toBe(200);
    const ids = (await res.json()).data.map((d) => d.id);
    expect(ids).toContain('d-on');
    expect(ids).not.toContain('d-off');
  });
});

describe('POST /api/disasters/trigger', () => {
  const body = { type: 'earthquake', severity: 4, lat: 24.15, lng: 120.68, radius_km: 25, description: 'quake' };

  it('rejects without the gov token (401)', async () => {
    const res = await fetch(`${base}/api/disasters/trigger`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
  });

  it('triggers a new disaster (201) and persists it active', async () => {
    const res = await gov('/api/disasters/trigger', 'POST', body);
    expect(res.status).toBe(201);
    expect((await res.json()).data.type).toBe('earthquake');
    expect(await collection('disasters').countDocuments({ active: true })).toBe(1);
  });

  it('suppresses a duplicate in the same area (200, disaster: null)', async () => {
    await gov('/api/disasters/trigger', 'POST', body);
    const dup = await gov('/api/disasters/trigger', 'POST', body); // same type + location
    expect(dup.status).toBe(200);
    expect((await dup.json()).disaster).toBeNull();
    expect(await collection('disasters').countDocuments({ active: true })).toBe(1);
  });

  it('rejects an invalid body (400 — missing lat/lng/radius_km)', async () => {
    const res = await gov('/api/disasters/trigger', 'POST', { type: 'flood' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/disasters/:id/deactivate', () => {
  it('E6 — deactivating a non-existent/inactive disaster → 404', async () => {
    const res = await gov('/api/disasters/ghost/deactivate', 'POST');
    expect(res.status).toBe(404);
  });
});
