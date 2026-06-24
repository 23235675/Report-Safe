'use strict';

const { getRedisClient } = require('./rateLimit');
const { logger } = require('./logger');

/**
 * Best-effort distributed leader lock for singleton background jobs (C4).
 *
 * Each scheduled tick tries `SET lock:<name> <holder> NX PX <ttl>` on the shared
 * Redis client. Only the instance that wins runs that tick; the lock auto-expires
 * after the TTL so a crashed holder is replaced within one interval. When Redis
 * is absent the deployment is single-instance, so there is nothing to coordinate
 * — every call is the "leader".
 *
 * ponytail: a per-tick NX lock, not a fencing token. Fine for these low-frequency,
 * idempotent-ish jobs (escalation/retention converge, stats is just a broadcast,
 * disaster inserts have the M4 unique index as a backstop). Upgrade to Redlock
 * only if a job becomes non-idempotent AND critical.
 */
async function acquireLock(name, ttlMs) {
  const client = getRedisClient();
  if (!client) return true; // single-instance — no coordination needed
  try {
    const res = await client.set(
      `lock:${name}`,
      `${process.pid}:${Date.now()}`,
      { NX: true, PX: Math.max(1000, Math.floor(ttlMs)) }
    );
    return res === 'OK';
  } catch (err) {
    // Redis hiccup → run the job rather than starve it. A transient duplicate is
    // safer than silently skipping a tick for these jobs.
    logger.warn('leader_lock_error', { name, error: err.message });
    return true;
  }
}

/** Run `fn` only if this instance wins the lock for `name` this tick. */
async function runIfLeader(name, ttlMs, fn) {
  if (!(await acquireLock(name, ttlMs))) return;
  return fn();
}

module.exports = { acquireLock, runIfLeader };
