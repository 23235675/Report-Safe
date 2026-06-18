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

/**
 * Express middleware: assign/propagate a request id and log one structured
 * line per completed request (method, path, status, latency).
 */
function requestLogger(req, res, next) {
  const id = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  const start = Date.now();
  res.on('finish', () => {
    logger.info('http_request', {
      reqId: id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
}

module.exports = { logger, requestLogger };
