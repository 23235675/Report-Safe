import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Phase 3 — missing-person case API (B19) + disaster dedup/lifecycle (M4/B20).
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const createDisastersRouter = require('../server/src/routes/disasters');
const createMissingPersonsRouter = require('../server/src/routes/missingPersons');
const triggerEngine = require('../server/src/services/triggerEngine');
const { DEFAULT_GOV_TOKEN } = require('../server/src/lib/authGuard');

let server, base;
const stubIo = { to: () => ({ emit: () => {} }), fetchSockets: async () => [] };

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/disasters', createDisastersRouter(stubIo));
  app.use('/api/missing-persons', createMissingPersonsRouter(stubIo));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

beforeEach(async () => {
  await collection('disasters').deleteMany({});
  await collection('missing_person_cases').deleteMany({});
});

const gov = (path, method = 'GET', body) => fetch(`${base}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEFAULT_GOV_TOKEN}` },
  body: body ? JSON.stringify(body) : undefined,
});

describe('B19: missing-person case management', () => {
  it('requires gov/volunteer to create a case (401 unauthenticated)', async () => {
    const res = await fetch(`${base}/api/missing-persons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lost Person' }),
    });
    expect(res.status).toBe(401);
  });

  it('opens, lists, updates and closes a case', async () => {
    const created = await (await gov('/api/missing-persons', 'POST', { name: 'Mei', report_id: 'r-1' })).json();
    expect(created.data.case_status).toBe('active');
    const id = created.data.id;

    const list = await (await gov('/api/missing-persons')).json();
    expect(list.data.some((c) => c.id === id)).toBe(true);

    await gov(`/api/missing-persons/${id}`, 'PUT', { case_status: 'found' });
    const closed = await gov(`/api/missing-persons/${id}`, 'DELETE');
    expect(closed.status).toBe(200);
    const doc = await collection('missing_person_cases').findOne({ _id: id });
    expect(doc.case_status).toBe('closed');
  });
});

describe('M4/B20: disaster dedup + deactivation lifecycle', () => {
  it('the partial-unique (type,active) index blocks a second active disaster of the same type', async () => {
    const a = await triggerEngine.activateDisaster(
      { type: 'typhoon', severity: 4, lat: 22.3, lng: 114.17, radius_km: 30 }, stubIo);
    // Same type but far outside the 30km dedup radius → app check passes, DB index catches it.
    const b = await triggerEngine.activateDisaster(
      { type: 'typhoon', severity: 4, lat: 30.0, lng: 120.0, radius_km: 30 }, stubIo);
    expect(a).toBeTruthy();
    expect(await collection('disasters').countDocuments({ type: 'typhoon', active: true })).toBe(1);
    expect(b.id).toBe(a.id); // returned the existing, not a duplicate
  });

  it('gov can deactivate a disaster, then the same type can be re-triggered', async () => {
    const a = await triggerEngine.activateDisaster(
      { type: 'flood', severity: 3, lat: 22.33, lng: 114.19, radius_km: 15 }, stubIo);
    const off = await gov(`/api/disasters/${a.id}/deactivate`, 'POST');
    expect(off.status).toBe(200);
    expect((await collection('disasters').findOne({ _id: a.id })).active).toBe(false);

    // Type is free again now that the previous one is inactive.
    const b = await triggerEngine.activateDisaster(
      { type: 'flood', severity: 3, lat: 22.33, lng: 114.19, radius_km: 15 }, stubIo);
    expect(b).toBeTruthy();
    expect(b.id).not.toBe(a.id);
  });
});
