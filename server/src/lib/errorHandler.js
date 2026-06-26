'use strict';

const { logger } = require('./logger');

/**
 * Last-resort Express error middleware (L6). Routes still hand-roll their own
 * try/catch + JSON responses; this catches anything that escapes them so a
 * thrown error becomes a clean JSON envelope with the request id — never a
 * stack trace leaked to the client. Register as the final app.use().
 */
function errorHandler(err, req, res, next) {
  logger.error('unhandled_error', {
    reqId: req.id,
    method: req.method,
    path: req.path,
    userId: req.auth?.userId ?? null,
    error: err.message,
    stack: err.stack,
  });
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || 'internal_error', message: 'Internal server error', reqId: req.id },
  });
}

module.exports = { errorHandler };
