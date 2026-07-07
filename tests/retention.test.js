import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// P1 — the PDPO retention PURGE engine (bootstrap step 9), previously untested.
// It deletes only RESOLVED reports (safe / rescued / deceased) whose last update
// is older than RETENTION_DAYS; unresolved cases are NEVER auto-purged. It also
// always runs the erasure crash-recovery sweep.
//
// RETENTION_DAYS is read once at module load, so it MUST be set before the
// service is required (below). Regular statements run in source order after the
// hoisted `import` above, so this assignment lands before the require.
process.env.RETENTION_DAYS = '30';

const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { purgeExpired } = require('../server/src/services/retentionService');

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => { await setup(); }, 30000);

beforeEach(async () => {
  await collection('reports').deleteMany({});
  await collection('status_history').deleteMany({});
  await collection('users').deleteMany({});
  await collection('device_push_tokens').deleteMany({});
  await collection('account_links').deleteMany({});
});

afterAll(async () => {
  delete process.env.RETENTION_DAYS; // don't leak enforcement into other suites
  await closeDb();
});

async function seedReport(id, status, ageDays) {
  const t = Date.now() - ageDays * DAY;
  await collection('reports').insertOne({
    _id: id, name: id, name_lower: id, status,
    lat: 22.3, lng: 114.1, user_type: 'mobile', created_at: t, updated_at: t,
  });
}
const exists = async (id) => !!(await collection('reports').findOne({ _id: id }));

describe('retentionService.purgeExpired', () => {
  it('purges resolved reports older than the window, keeps recent ones', async () => {
    await seedReport('old-safe', 'safe', 40);          // expired → purge
    await seedReport('old-rescued', 'rescued', 40);    // expired → purge
    await seedReport('old-deceased', 'deceased', 40);  // expired → purge
    await seedReport('new-safe', 'safe', 2);           // within window → keep

    const res = await purgeExpired();
    expect(res.purged).toBe(3);
    expect(await exists('old-safe')).toBe(false);
    expect(await exists('old-rescued')).toBe(false);
    expect(await exists('old-deceased')).toBe(false);
    expect(await exists('new-safe')).toBe(true);
  });

  it('NEVER purges unresolved cases, however old', async () => {
    await seedReport('old-need', 'need_help', 90);
    await seedReport('old-missing', 'potentially_missing', 90);
    await seedReport('old-injured', 'injured', 90);

    const res = await purgeExpired();
    expect(res.purged).toBe(0);
    expect(await exists('old-need')).toBe(true);
    expect(await exists('old-missing')).toBe(true);
    expect(await exists('old-injured')).toBe(true);
  });

  it('cascades status_history rows for the purged reports', async () => {
    await seedReport('old-safe', 'safe', 40);
    await collection('status_history').insertOne({
      _id: 'h1', report_id: 'old-safe', from_status: null, to_status: 'safe',
      changed_by: 'test', changed_at: Date.now(), notes: null,
    });
    await purgeExpired();
    expect(await collection('status_history').findOne({ report_id: 'old-safe' })).toBeNull();
  });

  it('finalizes a crash-stranded erasure tombstone (always-on crash recovery)', async () => {
    const now = Date.now();
    // A mid-erase crash: PII already scrubbed, tombstone pending, orphan device.
    await collection('users').insertOne({
      _id: 'u_tomb', phone: 'erased-u_tomb', name: 'Erased', deletion_state: 'pending',
      deletion_requested_at: now, created_at: now, updated_at: now,
    });
    await collection('device_push_tokens').insertOne({ _id: 'd_tomb', token: 'tk', user_id: 'u_tomb' });

    await purgeExpired();
    expect(await collection('users').findOne({ _id: 'u_tomb' })).toBeNull();
    expect(await collection('device_push_tokens').findOne({ _id: 'd_tomb' })).toBeNull();
  });
});
