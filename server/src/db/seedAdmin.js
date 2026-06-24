'use strict';

/**
 * Provisions a super_admin user from environment variables.
 * Called once during server bootstrap, after DB setup.
 *
 * Required env vars:
 *   SUPER_ADMIN_PHONE    — e.g. "+85298765000"
 *   SUPER_ADMIN_PASSWORD — strong passphrase (never stored in plain-text)
 *
 * Optional:
 *   SUPER_ADMIN_NAME — display name (default "Super Administrator")
 *
 * If a super_admin with that phone already exists, the record is updated so
 * a password rotation (change env var + restart) takes effect immediately.
 */

const crypto = require('crypto');
const { collection } = require('./mongo');
const { hashPassword, generateTokenPair } = require('../lib/authGuard');
const { normalizePhone } = require('../lib/zodSchemas');

async function seedAdmin() {
  // Credentials come from the environment ONLY — never hardcoded in source.
  // For local/testing, simple values live in server/.env (and .env.example);
  // production sets strong ones. This is what keeps the security level at the
  // released-version bar: the codebase ships no known password.
  // Phone is normalised to the canonical +852XXXXXXXX form so it's stored exactly
  // like every other account (SUPER_ADMIN_PHONE may be bare 8 digits) — and so a
  // restart MATCHES the existing admin and UPDATEs it instead of trying to insert
  // a duplicate (which fails on Cosmos: two admins with no personal_id collide on
  // the non-sparse-on-Cosmos unique index).
  const phone    = process.env.SUPER_ADMIN_PHONE ? normalizePhone(process.env.SUPER_ADMIN_PHONE) : undefined;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name     = process.env.SUPER_ADMIN_NAME || 'Super Administrator';

  if (!phone || !password) {
    console.log('[seedAdmin] SUPER_ADMIN_PHONE/PASSWORD not set — no super admin provisioned.');
    return;
  }

  // Production guard (mirrors authGuard's GOV_TOKEN warning): nudge operators to
  // a strong passphrase in production while leaving test credentials simple.
  if (process.env.NODE_ENV === 'production' && String(password).length < 12) {
    console.warn('[seedAdmin] SECURITY: SUPER_ADMIN_PASSWORD is weak (<12 chars) in production. Set a strong passphrase.');
  }

  const passwordHash = hashPassword(password);
  const now = Date.now();
  const tok = generateTokenPair(now);

  const existing = await collection('users').findOne({ phone }, { projection: { _id: 1 } });

  if (existing) {
    await collection('users').updateOne(
      { phone },
      { $set: {
          role: 'super_admin', password_hash: passwordHash,
          access_token_hash: tok.accessTokenHash, access_token_expires_at: tok.accessTokenExpiresAt,
          refresh_token_hash: tok.refreshTokenHash, refresh_token_expires_at: tok.refreshTokenExpiresAt,
          updated_at: now,
      } }
    );
    console.log(`[seedAdmin] Super admin updated: ${name} (${phone})`);
  } else {
    const id = crypto.randomUUID();
    // personal_id is intentionally OMITTED (no HKID) so the sparse-unique index skips it.
    await collection('users').insertOne({
      _id: id, phone, name, role: 'super_admin', user_type: 'mobile',
      password_hash: passwordHash, privacy_consent: true,
      access_token_hash: tok.accessTokenHash, access_token_expires_at: tok.accessTokenExpiresAt,
      refresh_token_hash: tok.refreshTokenHash, refresh_token_expires_at: tok.refreshTokenExpiresAt,
      created_at: now, updated_at: now,
    });
    console.log(`[seedAdmin] Super admin created: ${name} (${phone})`);
  }
}

module.exports = { seedAdmin };
