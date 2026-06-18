import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// OTP verification: unit behaviour of the service + HTTP gating of register/login.
// Enforcement is OFF by default; these tests toggle OTP_ENABLED to prove both
// the frictionless (off) and verified (on) paths.
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const createUsersRouter = require('../server/src/routes/users');
const otpService = require('../server/src/lib/otpService');

let server, base;

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/users', createUsersRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  delete process.env.OTP_ENABLED; // never leak enforcement into other suites
  otpService._reset();
  await new Promise((r) => server.close(r));
  await closeDb();
});

beforeEach(async () => {
  await collection('users').deleteMany({});
  otpService._reset();
  delete process.env.OTP_ENABLED;
});

const post = (path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

let seq = 0;
const phone = () => `9000${String(seq++).padStart(4, '0')}`;

describe('otpService (unit)', () => {
  it('generates a numeric code of the configured length', () => {
    const c = otpService.generateCode();
    expect(c).toMatch(/^\d{6}$/);
  });

  it('verifies a freshly requested code, once (one-time use)', async () => {
    const p = '+85290001111';
    const { dev_code } = await otpService.requestOtp(p);
    expect(dev_code).toMatch(/^\d{6}$/);
    expect(otpService.verifyOtp(p, dev_code)).toBe(true);
    // consumed — a second verify with the same code fails
    expect(otpService.verifyOtp(p, dev_code)).toBe(false);
  });

  it('rejects a wrong code', async () => {
    const p = '+85290002222';
    await otpService.requestOtp(p);
    expect(otpService.verifyOtp(p, '000000')).toBe(false);
  });

  it('rejects when no code was requested', () => {
    expect(otpService.verifyOtp('+85299999999', '123456')).toBe(false);
  });
});

describe('register/login OTP gating (HTTP)', () => {
  const reg = (p, extra = {}) => post('/api/users/register', {
    phone: p, name: 'OTP Tester', personal_id: 'A123456', privacy_consent: true, ...extra,
  });

  it('OTP off (default): register succeeds with no otp', async () => {
    const res = await reg(phone());
    expect(res.status).toBe(201);
  });

  it('OTP on: register without otp is rejected 401 otp_required', async () => {
    process.env.OTP_ENABLED = 'true';
    const res = await reg(phone());
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('otp_required');
  });

  it('OTP on: request-otp then register with the code succeeds', async () => {
    process.env.OTP_ENABLED = 'true';
    const p = phone();
    const otpRes = await post('/api/users/request-otp', { phone: p });
    expect(otpRes.status).toBe(200);
    const { dev_code, enabled } = await otpRes.json();
    expect(enabled).toBe(true);
    expect(dev_code).toMatch(/^\d{6}$/);

    const res = await reg(p, { otp: dev_code });
    expect(res.status).toBe(201);
  });

  it('OTP on: a wrong code is rejected', async () => {
    process.env.OTP_ENABLED = 'true';
    const p = phone();
    await post('/api/users/request-otp', { phone: p });
    const res = await reg(p, { otp: '000000' });
    expect(res.status).toBe(401);
  });
});
