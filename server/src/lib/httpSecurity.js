'use strict';

/*
 * Security headers + configurable CORS (replaces the blanket `cors()` and the
 * absence of `helmet`). Dependency-free essentials; tighten via env in prod.
 */

/**
 * Content-Security-Policy (H3). A browser-level backstop against injected
 * scripts — the mitigation that matters most while tokens still live in web
 * storage. Defaults are tuned for the bundled Vue SPA (self-hosted hashed JS;
 * Leaflet needs inline styles + https/data tiles; socket.io needs ws/wss).
 * Override wholesale with CONTENT_SECURITY_POLICY to tighten per deployment.
 */
const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: https:",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', process.env.CONTENT_SECURITY_POLICY || DEFAULT_CSP);
  // HSTS is harmless over http (browsers honour it only on https), so enable it
  // by default in production; ENABLE_HSTS=true forces it on in any environment.
  if (process.env.ENABLE_HSTS === 'true' || process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
  // L1: a wildcard origin in production lets any site call the API. Refuse to
  // start rather than ship an open CORS policy — set CORS_ORIGIN to a real
  // comma-separated allowlist.
  if ((raw === '*' || raw === '') && process.env.NODE_ENV === 'production') {
    throw new Error('CORS_ORIGIN must be set to an explicit allowlist in production (refusing to start with origin "*").');
  }
  if (raw === '*' || raw === '') return { origin: '*', methods };
  const allowlist = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return { origin: allowlist, methods };
}

module.exports = { securityHeaders, corsOptions };
