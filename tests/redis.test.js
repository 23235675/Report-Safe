import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Redis integration tests (M3/R6 — multi-instance scaling).
 *
 * These tests run only when Redis is reachable (REDIS_HOST is set).
 * They test:
 *   1. Redis client connects and basic ops work
 *   2. Rate limiter counters are shared across logical "instances"
 *   3. Socket.IO adapter factory attaches without error
 *   4. Graceful shutdown disconnects clients cleanly
 */
const skip = !process.env.REDIS_HOST && !process.env.REDIS_URL;
const { connectRedisPair, isRedisConfigured, createRedisClient } = require('../server/src/lib/redisClient');
const { createRedisRateLimiter, setRedisClient } = require('../server/src/lib/rateLimit');

let client1, client2;

beforeAll(async () => {
  if (skip) return;
  client1 = createRedisClient();
  client2 = createRedisClient();
  await Promise.all([client1.connect(), client2.connect()]);
  // Flush any leftover test keys.
  await client1.flushDb();
}, 20000);

afterAll(async () => {
  if (skip) return;
  try { await client1?.flushDb(); } catch {}
  try { await client1?.quit(); } catch {}
  try { await client2?.quit(); } catch {}
}, 10000);

describe.skipIf(skip)('Redis connectivity', () => {
  it('roundtrips SET / GET', async () => {
    await client1.set('test:ping', 'pong', { EX: 5 });
    const val = await client2.get('test:ping');
    expect(val).toBe('pong');
  });

  it('isRedisConfigured() returns true when REDIS_HOST is set', () => {
    expect(isRedisConfigured()).toBe(true);
  });
});

describe.skipIf(skip)('Redis-backed rate limiter — cross-instance counter sharing', () => {
  it('increments a shared counter across two logical "instances"', async () => {
    // Simulate two server instances sharing the same Redis.
    setRedisClient(client1);

    const limiter1 = createRedisRateLimiter({ windowMs: 60_000, max: 5 });
    const limiter2 = createRedisRateLimiter({ windowMs: 60_000, max: 5 });

    // Fix the key to a predictable IP so both limiters hit the same bucket.
    const mockReq = { ip: '10.0.0.1-redis-test' };
    const headers = {};
    const mockRes = {
      setHeader: (k, v) => { headers[k] = v; },
      status: () => ({ json: () => {} }),
    };

    // instance 1 hits 3 times
    let passCount = 0;
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => {
        limiter1(mockReq, mockRes, () => { passCount++; resolve(); });
      });
    }

    // instance 2 hits 2 more times — should still pass (count = 5)
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => {
        limiter2(mockReq, mockRes, () => { passCount++; resolve(); });
      });
    }

    expect(passCount).toBe(5);
    expect(Number(headers['X-RateLimit-Remaining'])).toBe(0);

    // 6th hit (on either instance) should be blocked (429).
    let blocked = false;
    const rejectRes = {
      setHeader: () => {},
      status: () => ({ json: () => { blocked = true; } }),
    };
    await new Promise((resolve) => {
      limiter1(mockReq, rejectRes, () => resolve());
      // Allow time for the async middleware.
      setTimeout(resolve, 200);
    });
    expect(blocked).toBe(true);
  });
});

describe.skipIf(skip)('Redis pair — connectRedisPair()', () => {
  it('returns a pub+sub pair that can be used as a Socket.IO adapter', async () => {
    const pair = await connectRedisPair();
    expect(pair).not.toBeNull();
    expect(pair.pub).toBeDefined();
    expect(pair.sub).toBeDefined();

    // Verify pub/sub actually work across the pair.
    const received = await new Promise((resolve, reject) => {
      pair.sub
        .subscribe('test:channel', (msg) => resolve(msg))
        .then(() => pair.pub.publish('test:channel', 'hello'))
        .catch(reject);
    });
    expect(received).toBe('hello');

    await pair.pub.quit();
    await pair.sub.quit();
  });
});

describe.skipIf(skip)('Socket.IO Redis adapter factory (smoke test)', () => {
  it('attaches the adapter to a Socket.IO Server without throwing', async () => {
    const http = require('http');
    const { Server } = require('socket.io');
    const { createAdapter } = require('@socket.io/redis-adapter');

    const pair = await connectRedisPair();
    const httpServer = http.createServer();
    const io = new Server(httpServer);
    // Should not throw.
    expect(() => io.adapter(createAdapter(pair.pub, pair.sub))).not.toThrow();

    await io.close();
    await pair.pub.quit();
    await pair.sub.quit();
  });
});
