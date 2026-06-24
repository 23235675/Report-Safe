import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// B21/M3 — DELETE /api/devices/:token is owner-scoped (was unauthenticated).
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const createDevicesRouter = require('../server/src/routes/devices');
const { DEFAULT_GOV_TOKEN, hashToken } = require('../server/src/lib/authGuard');

let server, base;

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/devices', createDevicesRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

beforeEach(async () => {
  await collection('device_push_tokens').deleteMany({});
  await collection('users').deleteMany({});
});

const del = (token, bearer) => fetch(`${base}/api/devices/${token}`, {
  method: 'DELETE',
  headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
});

async function seedDevice(token, userId) {
  await collection('device_push_tokens').insertOne({ _id: `d_${token}`, token, platform: 'ios', user_id: userId });
}
async function seedUser(id, accessToken) {
  await collection('users').insertOne({
    _id: id, phone: `+8525500${id.slice(-4)}`, name: id, role: 'citizen',
    access_token_hash: hashToken(accessToken), access_token_expires_at: Date.now() + 3600_000,
  });
}

describe('B21: device unregister requires owner or gov', () => {
  it('rejects an unauthenticated delete (401)', async () => {
    await seedDevice('tok-1', 'owner-1');
    expect((await del('tok-1')).status).toBe(401);
    expect(await collection('device_push_tokens').findOne({ token: 'tok-1' })).toBeTruthy();
  });

  it("rejects deleting another user's device (403)", async () => {
    await seedDevice('tok-2', 'owner-2');
    await seedUser('intruder', 'intruder-token');
    expect((await del('tok-2', 'intruder-token')).status).toBe(403);
    expect(await collection('device_push_tokens').findOne({ token: 'tok-2' })).toBeTruthy();
  });

  it('lets the owner delete their own device', async () => {
    await seedUser('owner-3', 'owner-3-token');
    await seedDevice('tok-3', 'owner-3');
    expect((await del('tok-3', 'owner-3-token')).status).toBe(200);
    expect(await collection('device_push_tokens').findOne({ token: 'tok-3' })).toBeNull();
  });

  it('lets a gov token force-deregister any device', async () => {
    await seedDevice('tok-4', 'someone');
    expect((await del('tok-4', DEFAULT_GOV_TOKEN)).status).toBe(200);
    expect(await collection('device_push_tokens').findOne({ token: 'tok-4' })).toBeNull();
  });
});
