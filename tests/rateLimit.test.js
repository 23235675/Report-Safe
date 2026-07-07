import { describe, it, expect, afterEach } from 'vitest';

// P3 — abuse protection (guardrail #3: rate limiting fails CLOSED). Covers the
// in-memory fallback (single-instance) and the Redis-tier fail-closed vs
// fail-open behaviour when Redis errors mid-request. Driven with fake req/res so
// no server or Redis is needed.
const { rateLimit, createRedisRateLimiter, setRedisClient } = require('../server/src/lib/rateLimit');

function fakeReqRes(ip = '1.2.3.4') {
  const headers = {};
  const res = {
    headers, statusCode: 0, body: null,
    setHeader(k, v) { headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req: { ip }, res };
}

afterEach(() => setRedisClient(null)); // never leak a fake client between tests

describe('in-memory limiter (single-instance fallback)', () => {
  it('allows up to max, then 429s with rate-limit headers', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 3, message: 'slow down' });
    const hit = () => {
      const { req, res } = fakeReqRes('shared-key');
      let nexted = false;
      mw(req, res, () => { nexted = true; });
      return { nexted, res };
    };
    expect(hit().nexted).toBe(true);  // 1
    expect(hit().nexted).toBe(true);  // 2
    expect(hit().nexted).toBe(true);  // 3
    const fourth = hit();             // 4 → over the limit
    expect(fourth.nexted).toBe(false);
    expect(fourth.res.statusCode).toBe(429);
    expect(fourth.res.body.error).toBe('slow down');
    expect(fourth.res.headers['X-RateLimit-Limit']).toBe('3');
  });
});

describe('Redis tier — fail-closed vs fail-open on a Redis outage (guardrail #3)', () => {
  const throwingClient = {
    incr: async () => { throw new Error('redis down'); },
    pExpire: async () => {},
    pTTL: async () => 1000,
  };

  it('a failClosed limiter 429s when Redis errors (protection stays on)', async () => {
    setRedisClient(throwingClient);
    const mw = createRedisRateLimiter({ windowMs: 60_000, max: 5, failClosed: true, message: 'busy' });
    const { req, res } = fakeReqRes();
    let nexted = false;
    await mw(req, res, () => { nexted = true; });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(429);
  });

  it('a fail-open limiter lets the request through when Redis errors (never lose a report)', async () => {
    setRedisClient(throwingClient);
    const mw = createRedisRateLimiter({ windowMs: 60_000, max: 5, failClosed: false });
    const { req, res } = fakeReqRes();
    let nexted = false;
    await mw(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });

  it('passes under the limit and reports remaining headers', async () => {
    let n = 0;
    setRedisClient({ incr: async () => (n += 1), pExpire: async () => {}, pTTL: async () => 30_000 });
    const mw = createRedisRateLimiter({ windowMs: 60_000, max: 5 });
    const { req, res } = fakeReqRes();
    let nexted = false;
    await mw(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(res.headers['X-RateLimit-Remaining']).toBe('4'); // max 5 − count 1
  });
});
