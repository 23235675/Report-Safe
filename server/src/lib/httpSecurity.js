'use strict';

/*
 * Security headers + configurable CORS (replaces the blanket `cors()` and the
 * absence of `helmet`). Dependency-free essentials; tighten via env in prod.
 */

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (process.env.ENABLE_HSTS === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

/**
 * Build cors() options from CORS_ORIGIN (comma-separated allowlist).
 * Defaults to '*' for local dev; set a real allowlist in production.
 */
function corsOptions() {
  const raw = (process.env.CORS_ORIGIN || '*').trim();
  const methods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'];
  if (raw === '*' || raw === '') return { origin: '*', methods };
  const allowlist = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return { origin: allowlist, methods };
}

module.exports = { securityHeaders, corsOptions };
