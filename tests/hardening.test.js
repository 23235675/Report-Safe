import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Covers the hardening sprint: HKO mapping (R9), per-user token helpers (M1),
// triage priority non-demotion (M5), pagination (M7), PDPO erasure (DPP6).
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const reportStore = require('../server/src/services/reportStore');
const { hkoSignal } = require('../server/src/services/triggerEngine');
const { generateAccessToken, hashToken, timingEqual } = require('../server/src/lib/authGuard');

beforeAll(async () => { await setup(); }, 30000);
beforeEach(async () => {
  await collection('reports').deleteMany({});
  await collection('users').deleteMany({});
  await collection('disasters').deleteMany({});
});
afterAll(async () => { await closeDb(); });

describe('HKO disaster signal mapping (R9)', () => {
  it('maps typhoon severity to HK Tropical Cyclone signals', () => {
    expect(hkoSignal('typhoon', 3)).toMatch(/T8/);
    expect(hkoSignal('typhoon', 5)).toMatch(/T10/);
  });
  it('maps rainstorm/flood to the Rainstorm Warning System', () => {
    expect(hkoSignal('rainstorm', 4)).toMatch(/Black/);
    expect(hkoSignal('flood', 1)).toMatch(/Amber/);
  });
  it('returns null for non-HK-standard hazards (e.g. wildfire)', () => {
    expect(hkoSignal('wildfire', 3)).toBeNull();
  });
});

describe('per-user access token helpers (M1)', () => {
  it('only ever stores the hash, never the plaintext token', () => {
    const { token, hash } = generateAccessToken();
    expect(token).toBeTruthy();
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toBe(token);
  });
  it('compares tokens in constant time', () => {
    expect(timingEqual('abc', 'abc')).toBe(true);
    expect(timingEqual('abc', 'abd')).toBe(false);
    expect(timingEqual('abc', 'abcd')).toBe(false);
  });
});

describe('triage priority never demotes an escalated need_help (M5)', () => {
  it('keeps awaiting_response at least as urgent as need_help and above injured', () => {
    const P = reportStore.STATUS_PRIORITY;
    expect(P.awaiting_response).toBe(P.need_help);
    expect(P.need_help).toBeLessThan(P.injured);
    expect(P.injured).toBeLessThan(P.safe);
  });
});

describe('pagination (M7)', () => {
  it('limits and offsets public search results', async () => {
    // searchByName now queries the USERS directory — seed 5 matching users.
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await collection('users').insertOne({
        _id: `pgu${i}`, phone: `+8529000000${i}`, name: 'Pagination Tester',
        role: 'citizen', privacy_consent: true, created_at: now + i, updated_at: now + i,
      });
    }
    const page1 = await reportStore.searchByName('Pagination', { limit: 2, offset: 0 });
    const page2 = await reportStore.searchByName('Pagination', { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1.map((r) => r.id)).not.toEqual(page2.map((r) => r.id));
  });
});

describe('PDPO erasure (DPP6)', () => {
  it('deletes the account and scrubs PII from its reports', async () => {
    const now = Date.now();
    await collection('users').insertOne({
      _id: 'u1', phone: '+85200000000', name: 'Erase Me', personal_id: 'A1234563',
      user_type: 'mobile', privacy_consent: true, created_at: now, updated_at: now,
    });
    await reportStore.upsertReport({
      id: 'er1', name: 'Erase Me', status: 'safe', lat: 22.3, lng: 114.1,
      phone: '+85200000000', personal_id: 'A1234563', user_id: 'u1', created_at: now,
    });

    const result = await reportStore.eraseUserData('u1');
    expect(result.deleted).toBe(1);
    expect(result.reportsScrubbed).toBe(1);

    expect(await collection('users').findOne({ _id: 'u1' })).toBeNull();
    const rep = await collection('reports').findOne({ _id: 'er1' });
    expect(rep.name).toBe('Erased');
    expect(rep.phone).toBeNull();
    expect(rep.personal_id).toBeNull();
  });
});
