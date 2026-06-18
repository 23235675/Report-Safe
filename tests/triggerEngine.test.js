import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// Runs against a disposable local MongoDB (see tests/_env.setup.js).
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const realtimeService = require('../server/src/services/realtimeService');
const triggerEngine = require('../server/src/services/triggerEngine');

// Minimal fake Socket.IO instance — broadcast is spied so it is never used.
const fakeIo = {};

beforeAll(async () => {
  await setup();
}, 30000);

beforeEach(async () => {
  await collection('disasters').deleteMany({});
  triggerEngine._resetCursor();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDb();
});

describe('triggerEngine.shouldTrigger thresholds', () => {
  it('magnitude 5.9 earthquake does NOT trigger', () => {
    expect(
      triggerEngine.shouldTrigger({ type: 'earthquake', magnitude: 5.9, severity: 1 })
    ).toBe(false);
  });

  it('magnitude 6.0 earthquake triggers', () => {
    expect(
      triggerEngine.shouldTrigger({ type: 'earthquake', magnitude: 6.0, severity: 1 })
    ).toBe(true);
  });

  it('severity 2 does NOT trigger', () => {
    expect(
      triggerEngine.shouldTrigger({ type: 'flood', severity: 2 })
    ).toBe(false);
  });

  it('severity 3 triggers', () => {
    expect(
      triggerEngine.shouldTrigger({ type: 'flood', severity: 3 })
    ).toBe(true);
  });
});

describe('triggerEngine.activateDisaster', () => {
  it('a magnitude 6.0 signal broadcasts the alert exactly once', async () => {
    const spy = vi
      .spyOn(realtimeService, 'broadcastDisasterAlert')
      .mockImplementation(() => {});

    const signal = {
      type: 'earthquake',
      magnitude: 6.0,
      severity: 4,
      lat: 24.15,
      lng: 120.68,
      radius_km: 25,
      description: 'test quake',
    };
    expect(triggerEngine.shouldTrigger(signal)).toBe(true);
    const disaster = await triggerEngine.activateDisaster(signal, fakeIo);

    expect(disaster).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(1);

    expect(await collection('disasters').countDocuments({})).toBe(1);
  });

  it('a duplicate signal in the same area does NOT create a second record', async () => {
    vi.spyOn(realtimeService, 'broadcastDisasterAlert').mockImplementation(() => {});

    const signal = {
      type: 'typhoon',
      severity: 4,
      lat: 22.32,
      lng: 114.17,
      radius_km: 50,
      description: 'typhoon',
    };

    const first = await triggerEngine.activateDisaster(signal, fakeIo);
    const second = await triggerEngine.activateDisaster(
      { ...signal, lat: 22.33, lng: 114.18 },
      fakeIo
    );

    expect(first).toBeTruthy();
    expect(second).toBeNull();

    expect(await collection('disasters').countDocuments({})).toBe(1);
  });
});
