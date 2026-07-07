import { describe, it, expect, afterEach } from 'vitest';

// P3 — security headers (guardrail-adjacent: CSP/HSTS/anti-clickjacking) and the
// CORS policy builder that REFUSES to start with a wildcard origin in production
// (guardrail against shipping an open API).
const { securityHeaders, corsOptions } = require('../server/src/lib/httpSecurity');

function fakeRes() {
  const headers = {};
  return { headers, setHeader(k, v) { headers[k] = v; } };
}

const ENV_KEYS = ['NODE_ENV', 'ENABLE_HSTS', 'CONTENT_SECURITY_POLICY', 'CORS_ORIGIN'];
const saved = {};
function snapshotEnv() { for (const k of ENV_KEYS) saved[k] = process.env[k]; }
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

describe('securityHeaders', () => {
  it('sets the hardening headers and calls next (HSTS off in dev)', () => {
    snapshotEnv();
    delete process.env.NODE_ENV; delete process.env.ENABLE_HSTS;
    const res = fakeRes(); let nexted = false;
    securityHeaders({}, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
    expect(res.headers['Content-Security-Policy']).toMatch(/default-src 'self'/);
    expect(res.headers['Permissions-Policy']).toMatch(/geolocation=\(\)/);
    expect(res.headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('enables HSTS when ENABLE_HSTS=true', () => {
    snapshotEnv();
    process.env.ENABLE_HSTS = 'true';
    const res = fakeRes();
    securityHeaders({}, res, () => {});
    expect(res.headers['Strict-Transport-Security']).toMatch(/max-age=31536000/);
  });

  it('honours a CONTENT_SECURITY_POLICY override', () => {
    snapshotEnv();
    process.env.CONTENT_SECURITY_POLICY = "default-src 'none'";
    const res = fakeRes();
    securityHeaders({}, res, () => {});
    expect(res.headers['Content-Security-Policy']).toBe("default-src 'none'");
  });
});

describe('corsOptions', () => {
  it('defaults to a wildcard origin in dev', () => {
    snapshotEnv();
    delete process.env.NODE_ENV; delete process.env.CORS_ORIGIN;
    expect(corsOptions().origin).toBe('*');
  });

  it('parses a comma-separated allowlist', () => {
    snapshotEnv();
    process.env.CORS_ORIGIN = 'https://a.example, https://b.example';
    expect(corsOptions().origin).toEqual(['https://a.example', 'https://b.example']);
  });

  it('REFUSES a wildcard origin in production (guardrail — no open CORS)', () => {
    snapshotEnv();
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = '*';
    expect(() => corsOptions()).toThrow(/allowlist/i);
  });
});
