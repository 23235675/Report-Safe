import { describe, it, expect, afterEach } from 'vitest';

// Full coverage of the distributed leader lock (C4 — singleton background jobs).
// Single-instance (no Redis) → always leader; Redis SET NX decides otherwise; a
// Redis error fails OPEN so a job is never starved. Driven with a fake client.
const { acquireLock, runIfLeader } = require('../server/src/lib/leaderLock');
const { setRedisClient } = require('../server/src/lib/rateLimit');

afterEach(() => setRedisClient(null));

describe('acquireLock', () => {
  it('single-instance (no Redis): always the leader', async () => {
    expect(await acquireLock('job', 1000)).toBe(true);
  });
  it("Redis SET NX → 'OK' means the lock was acquired", async () => {
    setRedisClient({ set: async () => 'OK' });
    expect(await acquireLock('job', 1000)).toBe(true);
  });
  it('Redis SET NX → null means it is held elsewhere (not leader)', async () => {
    setRedisClient({ set: async () => null });
    expect(await acquireLock('job', 1000)).toBe(false);
  });
  it('a Redis error fails OPEN — run rather than starve the job', async () => {
    setRedisClient({ set: async () => { throw new Error('redis down'); } });
    expect(await acquireLock('job', 1000)).toBe(true);
  });
});

describe('runIfLeader', () => {
  it('runs fn and returns its value when leader', async () => {
    let ran = false;
    const out = await runIfLeader('job', 1000, () => { ran = true; return 42; });
    expect(ran).toBe(true);
    expect(out).toBe(42);
  });
  it('skips fn when the lock is held elsewhere', async () => {
    setRedisClient({ set: async () => null });
    let ran = false;
    await runIfLeader('job', 1000, () => { ran = true; });
    expect(ran).toBe(false);
  });
});
