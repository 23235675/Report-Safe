'use strict';

const crypto = require('crypto');
const { logger } = require('./logger');

/*
 * OTP (one-time passcode) phone verification.
 *
 * The verification LOGIC here is production-ready, but enforcement is OFF by
 * default (OTP_ENABLED unset/false) so account creation stays frictionless
 * while the system is in testing. Flip OTP_ENABLED=true and wire a real SMS
 * provider in sendSms() to make register/login require a verified code.
 *
 * CONFIG:
 *   OTP_ENABLED      'true' => /register and /login require a valid otp. Default off.
 *   OTP_TTL_SECONDS  code lifetime in seconds (default 300 = 5 min).
 *   OTP_LENGTH       number of digits (default 6).
 *   OTP_DEV_ECHO     'true' => requestOtp returns the code (dev_code) in its
 *                    response. Defaults ON outside production so testers need no
 *                    real phone; FORCE-disabled when NODE_ENV=production.
 *   OTP_SMS_PROVIDER set to a real provider id in production (otherwise the
 *                    code is only logged and a warning is emitted).
 *
 * STORE: in-memory (per instance), like the in-memory rate-limiter tier. For a
 * multi-instance production deployment, back this with Redis (the same client
 * the rate limiter uses) so a code requested on one node verifies on another.
 */

/** phone -> { hash, expiresAt, attempts } */
const store = new Map();
const MAX_ATTEMPTS = 5;

function isEnabled()  { return process.env.OTP_ENABLED === 'true'; }
function ttlMs()      { return (Number(process.env.OTP_TTL_SECONDS) || 300) * 1000; }
function codeLength() { return Math.max(4, Math.min(10, Number(process.env.OTP_LENGTH) || 6)); }
/** Echo the code back to the caller for testing — never in production. */
function devEcho() {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.OTP_DEV_ECHO !== 'false';
}

function hash(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }

/** Cryptographically-random zero-padded numeric code. */
function generateCode() {
  const len = codeLength();
  return String(crypto.randomInt(0, 10 ** len)).padStart(len, '0');
}

/** Mask a phone for logs: "+85298765432" -> "····5432". */
function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return `····${d.slice(-4)}`;
}

// Periodically drop expired codes so the map can't grow unbounded.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k);
}, 60_000);
if (sweep.unref) sweep.unref();

/**
 * Pluggable SMS sender. Replace this body with a real provider (Twilio / Azure
 * Communication Services / a HK SMS gateway) for production delivery. Until
 * then it logs the code (dev) so the flow is testable end-to-end.
 */
async function sendSms(phone, code) {
  if (process.env.NODE_ENV === 'production' && !process.env.OTP_SMS_PROVIDER) {
    logger.warn('otp_sms_provider_unconfigured', { phone: maskPhone(phone) });
    return false;
  }
  logger.info('otp_send', { phone: maskPhone(phone), code });
  return true;
}

/**
 * Generate, store (hashed) and "send" a fresh OTP for a phone number.
 * @returns {Promise<{sent:boolean, dev_code?:string}>}
 */
async function requestOtp(phone) {
  const code = generateCode();
  store.set(phone, { hash: hash(code), expiresAt: Date.now() + ttlMs(), attempts: 0 });
  await sendSms(phone, code);
  return devEcho() ? { sent: true, dev_code: code } : { sent: true };
}

/**
 * Verify a submitted code for a phone. One-time use (consumed on success),
 * attempt-limited, expiry-checked, timing-safe compare.
 * @returns {boolean}
 */
function verifyOtp(phone, code) {
  const rec = store.get(phone);
  if (!rec) return false;
  if (rec.expiresAt <= Date.now()) { store.delete(phone); return false; }
  if (rec.attempts >= MAX_ATTEMPTS) { store.delete(phone); return false; }
  rec.attempts += 1;

  const a = Buffer.from(hash(String(code)));
  const b = Buffer.from(rec.hash);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) store.delete(phone); // consume on success
  return ok;
}

/** Test helper — clear all pending codes. */
function _reset() { store.clear(); }

module.exports = { isEnabled, requestOtp, verifyOtp, generateCode, _reset };
