import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Full coverage of the report-ingest rulebook in isolation (it's exercised end-
// to-end via reportsProxy; here each guard is unit-tested directly): identity
// derivation, the web-proxy rules, and the never-lose "unknown disaster" path.
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { prepareForStorage } = require('../server/src/services/reportPolicy');

beforeAll(async () => { await setup(); }, 30000);
beforeEach(async () => {
  await collection('reports').deleteMany({});
  await collection('users').deleteMany({});
  await collection('disasters').deleteMany({});
});
afterAll(async () => { await closeDb(); });

const govAuth = { kind: 'gov' };
const userAuth = (userId, name = 'Real User') => ({ kind: 'user', userId, user: { name } });

describe('applyIdentity', () => {
  it('self mobile report: derives user_id from the token, strips forged identity', async () => {
    const r = await prepareForStorage(
      { name: 'Me', status: 'need_help', user_type: 'mobile', lat: 22.3, lng: 114.1, user_id: 'forged', reported_for_user_id: 'victim' },
      userAuth('u1'),
    );
    expect(r.user_id).toBe('u1');
    expect(r.reported_by).toBe('self');
    expect(r.reported_for_user_id).toBeUndefined(); // forged value stripped, not re-added
  });

  it('gov token is trusted: attribution passes through unchanged', async () => {
    const r = await prepareForStorage(
      { name: 'X', status: 'safe', user_type: 'mobile', lat: 22.3, lng: 114.1, user_id: 'explicit' },
      govAuth,
    );
    expect(r.user_id).toBe('explicit');
  });

  it('a mobile report without a location is rejected (400)', async () => {
    await expect(prepareForStorage(
      { name: 'NoLoc', status: 'safe', user_type: 'mobile' }, userAuth('u1'),
    )).rejects.toThrow(/lat and lng/i);
  });
});

describe('web proxy rules', () => {
  it('rejects status "safe" from a web proxy (422)', async () => {
    await expect(prepareForStorage(
      { name: 'Subj', status: 'safe', user_type: 'web' }, userAuth('rep', 'Reporter'),
    )).rejects.toThrow(/safe/i);
  });

  it("inherits the subject's last non-web location by phone and links the account", async () => {
    const now = Date.now();
    await collection('users').insertOne({ _id: 'subj', phone: '+85261110000', name: 'Subject', created_at: now });
    await collection('reports').insertOne({
      _id: 'own', name: 'Subject', name_lower: 'subject', status: 'need_help',
      lat: 22.305, lng: 114.170, phone: '+85261110000', user_type: 'mobile', created_at: now, updated_at: now,
    });
    const r = await prepareForStorage(
      { name: 'Subject', status: 'injured', user_type: 'web', phone: '+85261110000' },
      userAuth('rep', 'Sister'),
    );
    expect(r.reported_by).toBe('family');
    expect(r.reported_for_user_id).toBe('subj');    // linked by phone
    expect(Number(r.lat)).toBeCloseTo(22.305, 2);    // location inherited
    expect(r.reporter_name).toBe('Sister');
  });

  it('rejects a proxy report when no location can be resolved (422)', async () => {
    await expect(prepareForStorage(
      { name: 'Ghost', status: 'missing', user_type: 'web', phone: '+85269999999' },
      userAuth('rep'),
    )).rejects.toThrow(/no known location/i);
  });
});

describe('ensureKnownDisaster (never lose a report)', () => {
  it('nulls an unknown disaster_id instead of rejecting', async () => {
    const r = await prepareForStorage(
      { name: 'X', status: 'safe', user_type: 'mobile', lat: 22.3, lng: 114.1, disaster_id: 'no-such' },
      userAuth('u1'),
    );
    expect(r.disaster_id).toBeNull();
  });

  it('keeps a known disaster_id', async () => {
    await collection('disasters').insertOne({ _id: 'd1', type: 'flood', active: true, lat: 22.3, lng: 114.1, radius_km: 10 });
    const r = await prepareForStorage(
      { name: 'X', status: 'safe', user_type: 'mobile', lat: 22.3, lng: 114.1, disaster_id: 'd1' },
      userAuth('u1'),
    );
    expect(r.disaster_id).toBe('d1');
  });
});
