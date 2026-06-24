import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// HTTP-level tests for the CFR incident + AED routes. Mounts the real routers
// (with their real auth) on a throwaway Express app, like safePlaces.test.js.
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { hashToken, getGovToken } = require('../server/src/lib/authGuard');
const createIncidentsRouter = require('../server/src/routes/incidents');
const createAedRouter = require('../server/src/routes/aed');
const createUsersRouter = require('../server/src/routes/users');

let server, base;
const GOV = getGovToken();
const CIT_TOK = 'cit-responder-token';
const GOVUSER_TOK = 'gov-responder-token';

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/incidents', createIncidentsRouter(null)); // io null — broadcasts no-op
  app.use('/api/aed', createAedRouter());
  app.use('/api/users', createUsersRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

const call = (path, tok, opts = {}) => fetch(`${base}${path}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(opts.headers || {}) },
});

async function addResponder(id, role, token, { lat, lng, skills = ['cpr', 'aed'], radius = 2 }) {
  const now = Date.now();
  await collection('users').insertOne({
    _id: id, phone: `+8525${id.slice(-7)}`, name: id, role,
    access_token_hash: hashToken(token), access_token_expires_at: now + 3600_000,
    responder_opt_in: true, responder_skills: skills, responder_max_radius_km: radius,
    created_at: now, updated_at: now,
  });
  await collection('device_push_tokens').insertOne({
    _id: `dev-${id}`, token: `tok-${id}`, platform: 'expo', user_id: id, lat, lng, updated_at: now,
  });
}

beforeEach(async () => {
  await Promise.all([
    collection('incidents').deleteMany({}),
    collection('incident_responses').deleteMany({}),
    collection('aed_locations').deleteMany({}),
    collection('users').deleteMany({}),
    collection('device_push_tokens').deleteMany({}),
  ]);
  await addResponder('cit-1', 'citizen', CIT_TOK, { lat: 22.30, lng: 114.17 });
  await addResponder('gov-1', 'government', GOVUSER_TOK, { lat: 22.30, lng: 114.17 });
  await collection('aed_locations').insertOne({
    _id: 'aed-1', name: 'Test AED', lat: 22.3005, lng: 114.17, active: true, source: 'seed', created_at: Date.now(),
  });
});

describe('POST /api/incidents (dispatch)', () => {
  it('rejects without the gov token', async () => {
    const res = await call('/api/incidents', null, { method: 'POST', body: JSON.stringify({ type: 'cardiac_arrest', lat: 22.30, lng: 114.17 }) });
    expect(res.status).toBe(401);
  });

  it('creates a public incident and matches nearby responders', async () => {
    const res = await call('/api/incidents', GOV, { method: 'POST', body: JSON.stringify({ type: 'cardiac_arrest', lat: 22.30, lng: 114.17, is_public: true }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('active');
    expect(body.matched).toBe(2); // both responders are in range with cpr
  });

  it('suppresses a duplicate within the dedupe radius', async () => {
    await call('/api/incidents', GOV, { method: 'POST', body: JSON.stringify({ type: 'fire', lat: 22.30, lng: 114.17 }) });
    const dup = await call('/api/incidents', GOV, { method: 'POST', body: JSON.stringify({ type: 'fire', lat: 22.3003, lng: 114.17 }) });
    const body = await dup.json();
    expect(dup.status).toBe(200);
    expect(body.incident).toBeNull();
  });
});

describe('GET /api/incidents/:id (detail + AEDs + privacy)', () => {
  it('returns incident, nearest AEDs and roster for a public incident', async () => {
    const created = await (await call('/api/incidents', GOV, { method: 'POST', body: JSON.stringify({ type: 'cardiac_arrest', lat: 22.30, lng: 114.17 }) })).json();
    const res = await call(`/api/incidents/${created.data.id}`, CIT_TOK);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.incident.id).toBe(created.data.id);
    expect(body.data.aeds.length).toBe(1);
    expect(body.data.aeds[0].distance_km).toBeGreaterThanOrEqual(0);
  });

  it('hides a residential incident from a non-government responder', async () => {
    const created = await (await call('/api/incidents', GOV, { method: 'POST', body: JSON.stringify({ type: 'cardiac_arrest', lat: 22.30, lng: 114.17, is_public: false }) })).json();
    const citRes = await call(`/api/incidents/${created.data.id}`, CIT_TOK);
    expect(citRes.status).toBe(403);
    const govRes = await call(`/api/incidents/${created.data.id}`, GOVUSER_TOK);
    expect(govRes.status).toBe(200);
  });
});

describe('POST /api/incidents/:id/respond', () => {
  it('records a responder status and is idempotent (upsert)', async () => {
    const created = await (await call('/api/incidents', GOV, { method: 'POST', body: JSON.stringify({ type: 'cardiac_arrest', lat: 22.30, lng: 114.17 }) })).json();
    const id = created.data.id;
    await call(`/api/incidents/${id}/respond`, CIT_TOK, { method: 'POST', body: JSON.stringify({ status: 'enroute', lat: 22.301, lng: 114.17 }) });
    await call(`/api/incidents/${id}/respond`, CIT_TOK, { method: 'POST', body: JSON.stringify({ status: 'onscene' }) });
    expect(await collection('incident_responses').countDocuments({ incident_id: id, user_id: 'cit-1' })).toBe(1);
    const row = await collection('incident_responses').findOne({ incident_id: id, user_id: 'cit-1' });
    expect(row.status).toBe('onscene');
  });

  it('cannot respond to a resolved incident', async () => {
    const created = await (await call('/api/incidents', GOV, { method: 'POST', body: JSON.stringify({ type: 'cardiac_arrest', lat: 22.30, lng: 114.17 }) })).json();
    const id = created.data.id;
    await call(`/api/incidents/${id}/resolve`, GOV, { method: 'POST', body: JSON.stringify({}) });
    const res = await call(`/api/incidents/${id}/respond`, CIT_TOK, { method: 'POST', body: JSON.stringify({ status: 'enroute' }) });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/incidents/:id/resolve', () => {
  it('marks the incident resolved', async () => {
    const created = await (await call('/api/incidents', GOV, { method: 'POST', body: JSON.stringify({ type: 'fire', lat: 22.30, lng: 114.17 }) })).json();
    const res = await call(`/api/incidents/${created.data.id}/resolve`, GOV, { method: 'POST', body: JSON.stringify({ status: 'stood_down' }) });
    expect(res.status).toBe(200);
    const doc = await collection('incidents').findOne({ _id: created.data.id });
    expect(doc.status).toBe('stood_down');
    expect(doc.resolved_at).toBeTruthy();
  });
});

describe('GET /api/aed', () => {
  it('returns nearest active AEDs sorted by distance', async () => {
    const res = await call('/api/aed?lat=22.30&lng=114.17&radius=2', null);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].id).toBe('aed-1');
  });
});

describe('PATCH /api/users/:id/responder', () => {
  it('lets a user opt in and clears skills on opt-out', async () => {
    const optIn = await call('/api/users/cit-1/responder', CIT_TOK, { method: 'PATCH', body: JSON.stringify({ responder_opt_in: true, responder_skills: ['cpr'], responder_max_radius_km: 0.8 }) });
    expect(optIn.status).toBe(200);
    const optOut = await call('/api/users/cit-1/responder', CIT_TOK, { method: 'PATCH', body: JSON.stringify({ responder_opt_in: false }) });
    expect(optOut.status).toBe(200);
    const doc = await collection('users').findOne({ _id: 'cit-1' });
    expect(doc.responder_opt_in).toBe(false);
    expect(doc.responder_skills).toEqual([]);
  });
});
