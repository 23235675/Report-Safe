'use strict';

const redis = require('redis');
const { logger } = require('./logger');

/**
 * Build a Redis client from env vars.
 * Supported vars:
 *   REDIS_URL       — full URL (redis://[:password@]host[:port][/db]), takes priority
 *   REDIS_HOST      — defaults to 'localhost'
 *   REDIS_PORT      — defaults to 6379
 *   REDIS_PASSWORD  — optional
 *   REDIS_DATABASE  — defaults to 0
 */
function createRedisClient() {
  const url = process.env.REDIS_URL;
  if (url) {
    return redis.createClient({ url });
  }
  return redis.createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
    database: Number(process.env.REDIS_DATABASE) || 0,
  });
}

/**
 * Whether Redis is configured in the current environment.
 * Returns true if any Redis env var is set.
 */
function isRedisConfigured() {
  return !!(
    process.env.REDIS_URL ||
    process.env.REDIS_HOST ||
    process.env.REDIS_PORT
  );
}

/**
 * Create and connect a Redis client pair (pub + sub) for the Socket.IO adapter.
 * Returns null if Redis is not configured — caller falls back to single-instance.
 * @returns {Promise<{pub: redis.RedisClientType, sub: redis.RedisClientType} | null>}
 */
async function connectRedisPair() {
  if (!isRedisConfigured()) return null;

  const pub = createRedisClient();
  const sub = pub.duplicate();

  pub.on('error', (err) => logger.error('redis_pub_error', { error: err.message }));
  sub.on('error', (err) => logger.error('redis_sub_error', { error: err.message }));

  await Promise.all([pub.connect(), sub.connect()]);
  logger.info('redis_connected', {
    host: process.env.REDIS_URL || `${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  });
  return { pub, sub };
}

module.exports = { createRedisClient, connectRedisPair, isRedisConfigured };
