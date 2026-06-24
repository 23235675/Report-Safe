'use strict';

const crypto = require('crypto');

/*
 * Minimal structured (JSON-lines) logger + Express request logging with
 * correlation IDs (M8/R10). Dependency-free; swap for pino in production by
 * keeping this module's surface (`logger.{error,warn,info,debug}` + `requestLogger`).
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function emit(level, msg, fields) {
  if (LEVELS[level] > threshold) return;
  const rec = { t: new Date().toISOString(), level, msg, ...(fields || {}) };
  const line = JSON.stringify(rec);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

const logger = {
  error: (msg, fields) => emit('error', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  info: (msg, fields) => emit('info', msg, fields),
  debug: (msg, fields) => emit('debug', msg, fields),
};

/** In-process request metrics (B23) — exposed via GET /api/metrics. */
const metrics = { requests: 0, errors: 0, totalMs: 0 };

/** Snapshot of request count, error rate and average latency. */
function getMetrics() {
  return {
    requests: metrics.requests,
    errors: metrics.errors,
    error_rate: metrics.requests ? Number((metrics.errors / metrics.requests).toFixed(4)) : 0,
    avg_latency_ms: metrics.requests ? Math.round(metrics.totalMs / metrics.requests) : 0,
  };
}

/**
 * Express middleware: assign/propagate a request id and log one structured
 * line per completed request (method, path, status, latency); also feeds the
 * /api/metrics counters.
 */
function requestLogger(req, res, next) {
  const id = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    metrics.requests += 1;
    metrics.totalMs += ms;
    if (res.statusCode >= 500) metrics.errors += 1;
    logger.info('http_request', {
      reqId: id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
    });
  });
  next();
}

module.exports = { logger, requestLogger, getMetrics };
