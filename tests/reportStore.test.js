import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Runs against a disposable local MongoDB (see tests/_env.setup.js).
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const reportStore = require('../server/src/services/reportStore');

beforeAll(async () => {
  await setup();
}, 30000);

beforeEach(async () => {
  await collection('reports').deleteMany({});
  await collection('status_history').deleteMany({});
  await collection('disasters').deleteMany({});
  await collection('account_links').deleteMany({});
  await collection('users').deleteMany({});
});

/**
 * searchByName now queries the USERS directory (joined to each user's latest
 * report). Seed a citizen user and link a report to them by user_id so the
 * search has someone to find.
 */
let _userSeq = 0;
async function makeUserWithReport({ name = 'Mei Wong', phone = '+85291234567', report = {} } = {}) {
  const userId = `u-${_userSeq++}`;
  const now = Date.now();
  await collection('users').insertOne({
    _id: userId, phone, name, role: 'citizen', privacy_consent: true, created_at: now, updated_at: now,
  });
  if (report !== null) {
    await reportStore.upsertReport(makeReport({ name, phone, user_id: userId, ...report }));
  }
  return userId;
}

afterAll(async () => {
  await closeDb();
});

function makeReport(overrides = {}) {
  return {
    id: 'r-1',
    name: 'Mei Wong',
    status: 'safe',
    lat: 25.033,
    lng: 121.5654,
    medical_notes: null,
    phone: '+85291234567',
    personal_id: 'A1234563', // valid synthetic HKID
    created_at: 1000,
    ...overrides,
  };
}

describe('reportStore.upsertReport', () => {
  it('stores all fields of a new report correctly', async () => {
    await reportStore.upsertReport(makeReport());
    const row = await collection('reports').findOne({ _id: 'r-1' });
    expect(row.name).toBe('Mei Wong');
    expect(row.status).toBe('safe');
    expect(row.lat).toBeCloseTo(25.033);
    expect(row.lng).toBeCloseTo(121.5654);
    expect(row.phone).toBe('+85291234567');
    expect(Number(row.created_at)).toBe(1000);
    expect(row.relay_count).toBe(0);
  });

  it('increments relay_count on duplicate UUID without changing immutable fields', async () => {
    await reportStore.upsertReport(makeReport());
    // Attempt to overwrite with different data + same id.
    await reportStore.upsertReport(
      makeReport({ status: 'need_help', lat: 0, lng: 0, name: 'Hacker', created_at: 9999 })
    );
    const row = await collection('reports').findOne({ _id: 'r-1' });
    expect(row.relay_count).toBe(1);
    expect(row.status).toBe('safe');
    expect(row.lat).toBeCloseTo(25.033);
    expect(row.lng).toBeCloseTo(121.5654);
    expect(row.name).toBe('Mei Wong');
    expect(Number(row.created_at)).toBe(1000);
  });
});

describe('reportStore.searchByName', () => {
  it('returns coarse (2dp) coordinates, not exact GPS', async () => {
    await makeUserWithReport();
    const results = await reportStore.searchByName('Mei');
    expect(results).toHaveLength(1);
    expect(results[0].coarse_lat).toBe(25.03);
    expect(results[0].coarse_lng).toBe(121.57);
    expect(results[0]).not.toHaveProperty('lat');
    expect(results[0]).not.toHaveProperty('lng');
  });

  it('NEVER leaks full phone, personal_id or medical notes on the public tier', async () => {
    await makeUserWithReport({ report: { medical_notes: 'diabetic' } });
    const results = await reportStore.searchByName('Mei');
    expect(results[0]).not.toHaveProperty('personal_id');
    expect(results[0]).not.toHaveProperty('phone');       // full phone never exposed
    expect(results[0]).not.toHaveProperty('medical_notes');
    expect(results[0].phone_masked).toBe('····4567');     // only last 4 digits shown
  });

  it('is case-insensitive on name', async () => {
    await makeUserWithReport();
    expect(await reportStore.searchByName('mei')).toHaveLength(1);
    expect(await reportStore.searchByName('MEI WONG')).toHaveLength(1);
  });

  it('H7: matches a name PREFIX, not a mid-string substring', async () => {
    await makeUserWithReport(); // "Mei Wong"
    expect(await reportStore.searchByName('Mei')).toHaveLength(1);  // prefix → match
    expect(await reportStore.searchByName('Wong')).toHaveLength(0); // mid-string → no match (anchored)
  });

  it('finds a person by phone number (last 8 digits)', async () => {
    await makeUserWithReport({ phone: '+85298765432' });
    const results = await reportStore.searchByName('98765432');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Mei Wong');
  });

  it('finds a registered user even with NO report yet (status null)', async () => {
    await makeUserWithReport({ name: 'Chan Tai Man', phone: '+85291112222', report: null });
    const results = await reportStore.searchByName('Chan');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Chan Tai Man');
    expect(results[0].status).toBeNull();
    expect(results[0].coarse_lat).toBeNull();
  });
});

describe('reportStore.getRescueView', () => {
  it('sorts need_help before injured before safe', async () => {
    const center = { lat: 25.03, lng: 121.56 };
    await reportStore.upsertReport(makeReport({ id: 's', status: 'safe', lat: center.lat, lng: center.lng }));
    await reportStore.upsertReport(makeReport({ id: 'i', status: 'injured', lat: center.lat, lng: center.lng, medical_notes: 'cut' }));
    await reportStore.upsertReport(makeReport({ id: 'h', status: 'need_help', lat: center.lat, lng: center.lng, medical_notes: 'trapped' }));

    const results = await reportStore.getRescueView(center.lat, center.lng, 50);
    expect(results.map((r) => r.status)).toEqual(['need_help', 'injured', 'safe']);
  });

  it('excludes reports outside the radius', async () => {
    const center = { lat: 25.03, lng: 121.56 };
    await reportStore.upsertReport(makeReport({ id: 'near', lat: 25.04, lng: 121.57 }));
    // Far away (Manila) — well outside a 20km radius.
    await reportStore.upsertReport(makeReport({ id: 'far', lat: 14.59, lng: 120.98 }));

    const results = await reportStore.getRescueView(center.lat, center.lng, 20);
    expect(results.map((r) => r.id)).toEqual(['near']);
  });

  it('exposes personal_id to the authenticated rescue tier', async () => {
    await reportStore.upsertReport(makeReport());
    const results = await reportStore.getRescueView(25.03, 121.56, 50);
    expect(results[0].personal_id).toBe('A1234563');
  });
});

describe('status_history audit trail', () => {
  it('writes an initial history row on first insert, none on relay', async () => {
    await reportStore.upsertReport(makeReport());
    await reportStore.upsertReport(makeReport()); // relay of the same UUID
    const rows = await collection('status_history').find({ report_id: 'r-1' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].from_status).toBeNull();
    expect(rows[0].to_status).toBe('safe');
  });

  it('records the from→to transition on updateStatus', async () => {
    await reportStore.upsertReport(makeReport({ status: 'need_help', medical_notes: 'trapped' }));
    await reportStore.updateStatus('r-1', 'rescued', 'test');
    const rows = await collection('status_history')
      .find({ report_id: 'r-1' }).sort({ changed_at: 1 }).toArray();
    expect(rows).toHaveLength(2);
    expect(rows[1].from_status).toBe('need_help');
    expect(rows[1].to_status).toBe('rescued');
    expect(rows[1].changed_by).toBe('test');
  });
});

describe('disaster linkage (no DB-level FK in MongoDB)', () => {
  it('stores the report even with an unknown disaster_id — integrity now lives at the route layer', async () => {
    // MongoDB has no FK to reject a dangling disaster_id, so the store accepts
    // it (Invariant #1: never lose a report). routes/reports.js proactively
    // nulls an unknown disaster_id before calling the store.
    const { inserted } = await reportStore.upsertReport(makeReport({ disaster_id: 'no-such-disaster' }));
    expect(inserted).toBe(true);
    const doc = await collection('reports').findOne({ _id: 'r-1' });
    expect(doc.disaster_id).toBe('no-such-disaster');
  });
});

describe('reportStore.getStats', () => {
  it('returns correct counts after inserts', async () => {
    await reportStore.upsertReport(makeReport({ id: 'a', status: 'safe' }));
    await reportStore.upsertReport(makeReport({ id: 'b', status: 'safe' }));
    await reportStore.upsertReport(makeReport({ id: 'c', status: 'injured', medical_notes: 'x' }));
    await reportStore.upsertReport(makeReport({ id: 'd', status: 'need_help', medical_notes: 'y' }));

    const stats = await reportStore.getStats();
    expect(stats.total).toBe(4);
    expect(stats.safe).toBe(2);
    expect(stats.injured).toBe(1);
    expect(stats.need_help).toBe(1);
    expect(stats.active_disasters).toBe(0);
  });
});
