import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Family-notification cascade: when someone is inside a disaster zone, their
// CONFIRMED loved ones are alerted (without entering disaster mode themselves).
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const pushService = require('../server/src/lib/pushService');
const triggerEngine = require('../server/src/services/triggerEngine');

// Central Hong Kong (inside) vs Gulf of Guinea (far outside).
const HK = { lat: 22.302, lng: 114.177 };
const FAR = { lat: 0, lng: 0 };
const DISASTER = { id: 'd-cascade', lat: HK.lat, lng: HK.lng, radius_km: 10, type: 'typhoon' };

let seq = 0;
async function addUser(id, name) {
  const now = Date.now();
  await collection('users').insertOne({
    _id: id, phone: `+85290000${String(seq++).padStart(3, '0')}`, name, created_at: now, updated_at: now,
  });
}
async function addDevice(userId, token, loc) {
  const now = Date.now();
  await collection('device_push_tokens').insertOne({
    _id: `dev-${token}`, user_id: userId, token, platform: 'android',
    lat: loc?.lat ?? null, lng: loc?.lng ?? null, created_at: now, updated_at: now,
  });
}
async function addLink(a, b, status) {
  const now = Date.now();
  await collection('account_links').insertOne({
    _id: `lnk-${a}-${b}`, user_a_id: a, user_b_id: b, status,
    confirmed_at: status === 'confirmed' ? now : null, created_at: now,
  });
}
async function addReport(userId, loc) {
  const now = Date.now();
  await collection('reports').insertOne({
    _id: `rep-${userId}`, name: 'placeholder', name_lower: 'placeholder', status: 'safe',
    lat: loc.lat, lng: loc.lng, user_id: userId, user_type: 'mobile', created_at: now, updated_at: now,
  });
}

beforeAll(async () => { await setup(); }, 30000);
beforeEach(async () => {
  await collection('reports').deleteMany({});
  await collection('account_links').deleteMany({});
  await collection('device_push_tokens').deleteMany({});
  await collection('disasters').deleteMany({});
  await collection('users').deleteMany({});
});
afterAll(async () => { await closeDb(); });

describe('findAffectedUsersInRadius', () => {
  it('returns users whose DEVICE is inside the zone, not those outside', async () => {
    await addUser('u-in', 'In Zone');
    await addUser('u-out', 'Out Zone');
    await addDevice('u-in', 'tok-in', HK);
    await addDevice('u-out', 'tok-out', FAR);

    const affected = await triggerEngine.findAffectedUsersInRadius(DISASTER);
    const ids = affected.map((a) => a.user_id);
    expect(ids).toContain('u-in');
    expect(ids).not.toContain('u-out');
  });

  it('also counts users who filed a REPORT from inside the zone', async () => {
    await addUser('u-rep', 'Reporter');
    await addReport('u-rep', HK);
    const affected = await triggerEngine.findAffectedUsersInRadius(DISASTER);
    expect(affected.map((a) => a.user_id)).toContain('u-rep');
  });

  it('carries the user display name for the alert body', async () => {
    await addUser('u-named', 'Wong Ka Yan');
    await addDevice('u-named', 'tok-named', HK);
    const affected = await triggerEngine.findAffectedUsersInRadius(DISASTER);
    expect(affected.find((a) => a.user_id === 'u-named').name).toBe('Wong Ka Yan');
  });
});

describe('findLovedOneDevices', () => {
  it('returns a CONFIRMED partner device, tagged with the affected person', async () => {
    await addUser('alice', 'Alice');
    await addUser('bob', 'Bob');
    await addLink('alice', 'bob', 'confirmed');
    await addDevice('bob', 'tok-bob', FAR); // Bob is NOT in the zone

    const affected = [{ user_id: 'alice', name: 'Alice' }];
    const devices = await triggerEngine.findLovedOneDevices(affected);
    expect(devices).toHaveLength(1);
    expect(devices[0].token).toBe('tok-bob');
    expect(devices[0].affectedName).toBe('Alice');
    expect(devices[0].partnerUserId).toBe('bob');
  });

  it('resolves the partner regardless of link column order (b→a)', async () => {
    await addUser('alice', 'Alice');
    await addUser('carol', 'Carol');
    await addLink('carol', 'alice', 'confirmed'); // alice is user_b here
    await addDevice('carol', 'tok-carol', FAR);

    const devices = await triggerEngine.findLovedOneDevices([{ user_id: 'alice', name: 'Alice' }]);
    expect(devices.map((d) => d.token)).toContain('tok-carol');
  });

  it('ignores PENDING links — consent is required before alerting', async () => {
    await addUser('alice', 'Alice');
    await addUser('dave', 'Dave');
    await addLink('alice', 'dave', 'pending');
    await addDevice('dave', 'tok-dave', FAR);

    const devices = await triggerEngine.findLovedOneDevices([{ user_id: 'alice', name: 'Alice' }]);
    expect(devices.map((d) => d.token)).not.toContain('tok-dave');
  });

  it('excludes handles already alerted directly (relative also in-zone)', async () => {
    await addUser('alice', 'Alice');
    await addUser('bob', 'Bob');
    await addLink('alice', 'bob', 'confirmed');
    await addDevice('bob', 'tok-bob', HK); // Bob is ALSO in the zone

    const directTokens = new Set(['tok-bob']); // Bob already got the direct push
    const devices = await triggerEngine.findLovedOneDevices(
      [{ user_id: 'alice', name: 'Alice' }],
      directTokens
    );
    expect(devices.map((d) => d.token)).not.toContain('tok-bob');
  });
});

describe('findLovedOnePartners (open-app socket path)', () => {
  it('returns confirmed partner user ids even with NO device handle', async () => {
    await addUser('alice', 'Alice');
    await addUser('bob', 'Bob');
    await addLink('alice', 'bob', 'confirmed');
    // Note: Bob has NO device_push_tokens row — he must still be reachable by socket.

    const partners = await triggerEngine.findLovedOnePartners([{ user_id: 'alice', name: 'Alice' }]);
    expect(partners).toHaveLength(1);
    expect(partners[0].partnerUserId).toBe('bob');
    expect(partners[0].affectedUserId).toBe('alice');
    expect(partners[0].affectedName).toBe('Alice');
  });

  it('excludes pending links', async () => {
    await addUser('alice', 'Alice');
    await addUser('dave', 'Dave');
    await addLink('alice', 'dave', 'pending');
    const partners = await triggerEngine.findLovedOnePartners([{ user_id: 'alice', name: 'Alice' }]);
    expect(partners.map((p) => p.partnerUserId)).not.toContain('dave');
  });
});

describe('cascadeToLovedOnes (integration)', () => {
  it('runs end-to-end and is a graceful no-op when push is unconfigured', async () => {
    await addUser('alice', 'Alice');
    await addUser('bob', 'Bob');
    await addLink('alice', 'bob', 'confirmed');
    await addDevice('alice', 'tok-alice', HK); // Alice in zone
    await addDevice('bob', 'tok-bob', FAR);    // Bob is her loved one, far away

    const directTokens = new Set(['tok-alice']);
    // Push unconfigured in tests → sendLovedOneAlert no-ops, returns no dead tokens.
    const dead = await triggerEngine.cascadeToLovedOnes(DISASTER, directTokens, null);
    expect(Array.isArray(dead)).toBe(true);
    expect(dead).toHaveLength(0);
  });
});

describe('pushService loved-one payload', () => {
  it('builds a typed loved_one_alert payload (NOT disaster_alert)', () => {
    const ios = pushService.buildLovedOnePayload('ios', DISASTER, 'Alice');
    const android = pushService.buildLovedOnePayload('android', DISASTER, 'Alice');
    expect(ios.format).toBe('apple');
    expect(android.format).toBe('gcm');
    expect(ios.json).toMatch(/loved_one_alert/);
    expect(android.json).toMatch(/loved_one_alert/);
    expect(android.json).toMatch(/Alice/);
  });

  it('sendLovedOneAlert is a graceful no-op when unconfigured', async () => {
    const prevCs = process.env.AZURE_NH_CONNECTION_STRING;
    const prevHub = process.env.AZURE_NH_HUB_NAME;
    delete process.env.AZURE_NH_CONNECTION_STRING;
    delete process.env.AZURE_NH_HUB_NAME;
    const res = await pushService.sendLovedOneAlert(DISASTER, [
      { token: 'x', platform: 'android', affectedName: 'Alice' },
    ]);
    expect(res.configured).toBe(false);
    expect(res.sent).toBe(0);
    if (prevCs) process.env.AZURE_NH_CONNECTION_STRING = prevCs;
    if (prevHub) process.env.AZURE_NH_HUB_NAME = prevHub;
  });
});
