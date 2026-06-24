'use strict';

const { logger } = require('./logger');

/*
 * Rate limiter with two tiers (M2 / R6):
 *
 *  1. Redis-backed (multi-instance) — createRateLimiter(redisClient, opts)
 *     Uses INCR + PEXPIRE with a fixed-window key so every instance shares the
 *     same counter.  Requires a connected redis client instance.
 *
 *  2. In-memory (single-instance / fallback) — rateLimit(opts)
 *     Falls back automatically when no Redis client is supplied.
 *
 * Both return a standard Express middleware with identical behaviour and the
 * same X-RateLimit-* response headers.  The factory rateLimit() auto-selects
 * the tier based on whether a global Redis client has been registered via
 * setRedisClient().
 */

/** Module-level Redis client, set by setRedisClient() once bootstrap has connected. */
let _redisClient = null;

function setRedisClient(client) {
  _redisClient = client;
  logger.info('rate_limiter_redis_enabled');
}

function getRedisClient() { return _redisClient; }

// ── Redis-backed limiter ────────────────────────────────────────────────────

function createRedisRateLimiter({ windowMs = 60_000, max = 60, keyFn, message, failClosed = false } = {}) {
  return async function redisRateLimiter(req, res, next) {
    const client = _redisClient;
    if (!client) return next(); // single-instance / Redis not configured — no limiting

    const key = `rl:${String((keyFn ? keyFn(req) : req.ip) || 'unknown')}:${Math.floor(Date.now() / windowMs)}`;
    try {
      const count = await client.incr(key);
      if (count === 1) {
        // First hit in this window — set TTL so the key expires automatically.
        await client.pExpire(key, windowMs);
      }
      const ttlMs = await client.pTTL(key);

      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));

      if (count > max) {
        const retryAfter = ttlMs > 0 ? Math.ceil(ttlMs / 1000) : Math.ceil(windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({ error: message || 'Too many requests — slow down.' });
      }
      return next();
    } catch (err) {
      // Redis errored mid-request (M9). failClosed limiters (the general /api
      // ceiling) return 429 so an outage can't silently disable abuse protection;
      // fail-open limiters (report ingest) let it through — losing a report is
      // worse than briefly skipping a rate check.
      logger.warn('redis_rate_limit_error', { error: err.message, failClosed });
      if (failClosed) {
        res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({ error: message || 'Service busy — please retry shortly.' });
      }
      return next();
    }
  };
}

// ── In-memory limiter ───────────────────────────────────────────────────────

function createInMemoryRateLimiter({ windowMs = 60_000, max = 60, keyFn, message } = {}) {
  /** @type {Map<string, {count:number, resetAt:number}>} */
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function inMemoryRateLimiter(req, res, next) {
    const key = String((keyFn ? keyFn(req) : req.ip) || 'unknown');
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)));

    if (rec.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000)));
      return res.status(429).json({ error: message || 'Too many requests — slow down.' });
    }
    return next();
  };
}

// ── Auto-selecting factory ──────────────────────────────────────────────────

/**
 * Creates a rate-limiter middleware that automatically uses Redis when
 * setRedisClient() has been called, falling back to in-memory otherwise.
 *
 * The returned middleware delegates to whichever tier is active at call time,
 * so it handles a Redis connection that comes up after middleware is mounted.
 */
function rateLimit(opts = {}) {
  const redisMiddleware  = createRedisRateLimiter(opts);
  const memoryMiddleware = createInMemoryRateLimiter(opts);

  return function autoRateLimiter(req, res, next) {
    if (_redisClient) return redisMiddleware(req, res, next);
    return memoryMiddleware(req, res, next);
  };
}

module.exports = {
  rateLimit,
  setRedisClient,
  getRedisClient,
  createRedisRateLimiter,
  createInMemoryRateLimiter,
};
