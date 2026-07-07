import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// P1 — the missing-person ESCALATION engine (bootstrap step 9), previously
// untested. Two time-based passes:
//   need_help          ──(> NEED_HELP_THRESHOLD)──▶ awaiting_response
//   awaiting_response  ──(> AWAITING_THRESHOLD)───▶ potentially_missing
// This suite drives both the store primitive (escalateStaleReports, with
// controlled thresholds) and the engine wrapper (runEscalation, default
// 45-min / 2-hr thresholds + the dashboard stats broadcast).
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const reportStore = require('../server/src/services/reportStore');
const realtimeService = require('../server/src/services/realtimeService');
const missingPersonService = require('../server/src/services/missingPersonService');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const fakeIo = {};

beforeAll(async () => { await setup(); }, 30000);

beforeEach(async () => {
  await collection('reports').deleteMany({});
  await collection('status_history').deleteMany({});
  vi.restoreAllMocks();
});

afterAll(async () => { await closeDb(); });

// Insert directly so updated_at can be backdated (upsertReport always stamps now).
async function seedReport(id, status, ageMs) {
  const t = Date.now() - ageMs;
  await collection('reports').insertOne({
    _id: id, name: id, name_lower: id, status,
    lat: 22.30, lng: 114.17, user_type: 'mobile', created_at: t, updated_at: t,
  });
}
const statusOf = async (id) => (await collection('reports').findOne({ _id: id })).status;

describe('reportStore.escalateStaleReports (primitive)', () => {
  it('escalates only need_help reports older than the threshold', async () => {
    await seedReport('stale', 'need_help', 60 * MIN); // older than the 30-min threshold
    await seedReport('fresh', 'need_help', 5 * MIN);  // newer → untouched

    const res = await reportStore.escalateStaleReports(30 * MIN, 2 * HOUR);
    expect(res.escalatedToAwaiting).toBe(1);
    expect(await statusOf('stale')).toBe('awaiting_response');
    expect(await statusOf('fresh')).toBe('need_help');
  });

  it('escalates awaiting_response → potentially_missing past its threshold', async () => {
    await seedReport('await-old', 'awaiting_response', 3 * HOUR);
    const res = await reportStore.escalateStaleReports(30 * MIN, 2 * HOUR);
    expect(res.escalatedToMissing).toBe(1);
    expect(await statusOf('await-old')).toBe('potentially_missing');
  });

  it('does NOT double-hop a need_help report in a single run', async () => {
    // A report just escalated to awaiting_response gets updated_at=now, so pass 2
    // (which needs updated_at older than the awaiting threshold) must skip it.
    await seedReport('one-hop', 'need_help', 10 * HOUR);
    const res = await reportStore.escalateStaleReports(30 * MIN, 2 * HOUR);
    expect(res.escalatedToAwaiting).toBe(1);
    expect(res.escalatedToMissing).toBe(0);
    expect(await statusOf('one-hop')).toBe('awaiting_response');
  });

  it('records each transition in status_history as the escalation engine', async () => {
    await seedReport('hist', 'awaiting_response', 3 * HOUR);
    await reportStore.escalateStaleReports(30 * MIN, 2 * HOUR);
    const rows = await collection('status_history').find({ report_id: 'hist' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].from_status).toBe('awaiting_response');
    expect(rows[0].to_status).toBe('potentially_missing');
    expect(rows[0].changed_by).toBe('escalation-engine');
  });

  it('leaves resolved/other statuses (safe, injured) alone even when ancient', async () => {
    await seedReport('safe', 'safe', 10 * HOUR);
    await seedReport('inj', 'injured', 10 * HOUR);
    const res = await reportStore.escalateStaleReports(1, 1); // threshold ~0
    expect(res.escalatedToAwaiting).toBe(0);
    expect(res.escalatedToMissing).toBe(0);
    expect(await statusOf('safe')).toBe('safe');
    expect(await statusOf('inj')).toBe('injured');
  });
});

describe('missingPersonService.runEscalation (engine + broadcast)', () => {
  it('runs both passes on the default thresholds and broadcasts fresh stats', async () => {
    const spy = vi.spyOn(realtimeService, 'broadcastStats').mockImplementation(() => {});
    // Older than the 2-hour default awaiting threshold (and the 45-min one).
    await seedReport('nh', 'need_help', 3 * HOUR);
    await seedReport('aw', 'awaiting_response', 3 * HOUR);

    await missingPersonService.runEscalation(fakeIo);

    expect(await statusOf('nh')).toBe('awaiting_response');
    expect(await statusOf('aw')).toBe('potentially_missing');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op — and does NOT broadcast — when nothing is stale', async () => {
    const spy = vi.spyOn(realtimeService, 'broadcastStats').mockImplementation(() => {});
    await seedReport('recent', 'need_help', 1 * MIN); // well under the 45-min threshold
    await missingPersonService.runEscalation(fakeIo);
    expect(await statusOf('recent')).toBe('need_help');
    expect(spy).not.toHaveBeenCalled();
  });
});
