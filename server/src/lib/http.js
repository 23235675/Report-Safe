'use strict';

/**
 * Operational error a handler may throw. `expose` marks the message as safe to
 * return to the client (all 4xx); 5xx keep the generic envelope.
 */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = status < 500;
  }
}

/** Route a rejected async handler into the central errorHandler. */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Parse req[source] with a Zod schema. 400 with details on failure; the parsed
 * (transformed) value lands on req.valid. Handlers never touch req.body again.
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const parsed = schema.safeParse(req[source]);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
  }
  req.valid = parsed.data;
  return next();
};

module.exports = { HttpError, asyncHandler, validate };
