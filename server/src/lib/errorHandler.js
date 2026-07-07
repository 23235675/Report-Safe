'use strict';

const { logger } = require('./logger');

/**
 * Central error middleware — the only try/catch in the request path.
 * A thrown HttpError(4xx) surfaces its message and optional code in the same
 * `{ error, code? }` body shape the routes have always returned; anything else
 * is a masked 500. Never leaks a stack to the client. Register as the final
 * app.use().
 */
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  logger[status >= 500 ? 'error' : 'warn']('request_failed', {
    reqId: req.id,
    method: req.method,
    path: req.path,
    status,
    userId: req.auth?.userId ?? null,
    error: err.message,
    ...(status >= 500 ? { stack: err.stack } : {}),
  });
  if (res.headersSent) return next(err);
  if (err.expose) {
    return res.status(status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
      reqId: req.id,
    });
  }
  return res.status(status).json({ error: 'Internal server error', reqId: req.id });
}

module.exports = { errorHandler };
