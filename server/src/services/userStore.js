'use strict';

/*
 * Citizen-account persistence: registration upsert, login/refresh token
 * writes (with rotation + reuse detection), profile reads and updates.
 * All PII masking and secret-stripping happens HERE — a raw user doc never
 * crosses this module's boundary.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { generateTokenPair, hashToken } = require('../lib/authGuard');
const { mapId, unwrap } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');
const { logger } = require('../lib/logger');

const DUP_PERSONAL_ID = 'This personal ID is already registered to another phone number.';

/** An HKID must never travel back out in full: "A1234567" → "A•••••(7)". */
function maskPersonalId(pid) {
  if (!pid) return null;
  return `${pid[0]}${'•'.repeat(Math.max(0, pid.length - 2))}(${pid[pid.length - 1]})`;
}

/** Public user shape: _id → id, strip secret hashes, mask the HKID. */
function publicUser(doc) {
  if (!doc) return doc;
  const { _id, access_token_hash, refresh_token_hash, password_hash, name_lower, ...rest } = doc;
  return { id: _id, ...rest, personal_id: maskPersonalId(rest.personal_id) };
}

/** Map a Mongo duplicate-key error (personal_id unique index) to a 409. */
function rethrowDup(err) {
  if (err && err.code === 11000) throw new HttpError(409, DUP_PERSONAL_ID);
  throw err;
}

/** The $set fields written whenever a fresh token pair is issued. */
function tokenSet(tok, now) {
  return {
    access_token_hash:        tok.accessTokenHash,
    access_token_expires_at:  tok.accessTokenExpiresAt,
    refresh_token_hash:       tok.refreshTokenHash,
    refresh_token_expires_at: tok.refreshTokenExpiresAt,
    updated_at:               now,
  };
}

/**
 * Create-or-update by phone. Provided fields overwrite, absent ones keep prior;
 * user_type/role/created_at are insert-only. Returns the public user + the
 * one-time plaintext token pair.
 */
async function register({ phone, name, gender, email, personal_id, user_type, privacy_consent }) {
  const now = Date.now();
  const tok = generateTokenPair(now);
  const insertOnly = { _id: crypto.randomUUID(), phone, user_type, role: 'citizen', created_at: now };
  const set = { name, gender, personal_id, privacy_consent, ...tokenSet(tok, now) };
  if (email != null) set.email = email; else insertOnly.email = null;

  let res;
  try {
    res = await collection('users').findOneAndUpdate(
      { phone },
      { $setOnInsert: insertOnly, $set: set },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    rethrowDup(err);
  }
  return { user: publicUser(unwrap(res)), tok };
}

/** Phone-only login for an existing account; issues a fresh token pair. */
async function login(phone) {
  const u = await collection('users').findOne(
    { phone },
    { projection: { phone: 1, name: 1, gender: 1, email: 1, personal_id: 1, user_type: 1, role: 1, privacy_consent: 1 } }
  );
  if (!u) throw new HttpError(404, 'No account found for that number. Please register first.');

  const now = Date.now();
  const tok = generateTokenPair(now);
  await collection('users').updateOne({ _id: u._id }, { $set: tokenSet(tok, now) });
  return { user: { ...mapId(u), personal_id: maskPersonalId(u.personal_id) }, tok };
}

/**
 * Exchange a refresh token for a new pair. Refresh tokens rotate (one-time
 * use) with reuse detection: the immediately-previous hash is kept as a
 * tripwire — presenting it again means the token was stolen and replayed, so
 * the whole family is invalidated and every session must sign in again.
 */
async function rotateRefreshToken(refreshToken) {
  const users = collection('users');
  const presented = hashToken(refreshToken);

  const found = await users.findOne(
    { refresh_token_hash: presented },
    { projection: { refresh_token_expires_at: 1 } }
  );
  if (!found) {
    const reused = await users.findOne({ prev_refresh_token_hash: presented }, { projection: { _id: 1 } });
    if (!reused) throw new HttpError(401, 'Invalid refresh token', 'refresh_invalid');
    await users.updateOne(
      { _id: reused._id },
      { $set: { access_token_hash: null, refresh_token_hash: null, prev_refresh_token_hash: null, updated_at: Date.now() } }
    );
    throw new HttpError(401, 'Refresh token reuse detected — please sign in again.', 'token_reuse');
  }

  const exp = found.refresh_token_expires_at;
  if (exp != null && Number(exp) < Date.now()) {
    throw new HttpError(401, 'Refresh token expired', 'refresh_expired');
  }

  const now = Date.now();
  const tok = generateTokenPair(now);
  await users.updateOne(
    { _id: found._id },
    { $set: { ...tokenSet(tok, now), prev_refresh_token_hash: presented } }
  );
  return tok;
}

/** Profile by phone — HKID returned masked. */
async function profileByPhone(phone) {
  const u = await collection('users').findOne(
    { phone },
    { projection: { phone: 1, name: 1, gender: 1, email: 1, personal_id: 1, user_type: 1, role: 1, privacy_consent: 1, created_at: 1, updated_at: 1 } }
  );
  if (!u) throw new HttpError(404, 'User not found');
  return { ...mapId(u), personal_id: maskPersonalId(u.personal_id) };
}

/** Update own profile — only fields the caller actually provided are written. */
async function updateProfile(id, { name, email, personal_id, privacy_consent }) {
  const set = { updated_at: Date.now() };
  if (name != null) set.name = name;
  if (email != null) set.email = email;
  if (personal_id != null) set.personal_id = personal_id;
  if (privacy_consent != null) set.privacy_consent = privacy_consent;

  let res;
  try {
    res = await collection('users').findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' });
  } catch (err) {
    rethrowDup(err);
  }
  const u = unwrap(res);
  if (!u) throw new HttpError(404, 'User not found');
  return publicUser(u);
}

/**
 * CFR opt-in/out. Opting in is explicit consent to be alerted and to share
 * live location while responding; opting out clears skills so a stale skill
 * can't keep matching.
 */
async function setResponderProfile(id, { responder_opt_in, responder_skills, responder_max_radius_km }) {
  const res = await collection('users').findOneAndUpdate(
    { _id: id },
    {
      $set: {
        responder_opt_in,
        responder_skills: responder_opt_in ? responder_skills : [],
        responder_max_radius_km,
        updated_at: Date.now(),
      },
    },
    { returnDocument: 'after' }
  );
  const u = unwrap(res);
  if (!u) throw new HttpError(404, 'User not found');
  return publicUser(u);
}

/**
 * PDPO erasure (DPP6 / data-subject deletion): delete the account and scrub
 * personal data from any reports tied to it. Report rows are kept (so aggregate
 * counts stay intact) but their identifying fields are nulled and the user
 * linkage is cleared.
 *
 * MongoDB has no FK cascades, so they are emulated explicitly:
 *   account_links       CASCADE  → delete links touching the user
 *   device_push_tokens  CASCADE  → delete the user's device handles
 *   safe_places         CASCADE  → delete the user's submissions
 *   reports.user_id / reported_for_user_id SET NULL → nulled in the scrub
 */
async function eraseUser(userId) {
  try {
    const now = Date.now();
    // Phase 1a — scrub PII from the user's reports (rows kept for aggregate counts).
    const scrub = await collection('reports').updateMany(
      { $or: [{ user_id: userId }, { reported_for_user_id: userId }] },
      {
        $set: {
          name: 'Erased', name_lower: 'erased', phone: null, personal_id: null,
          medical_notes: null, reporter_name: null,
          user_id: null, reported_for_user_id: null, updated_at: now,
        },
      }
    );

    // Phase 1b — scrub PII from the USER doc IN PLACE and tombstone it FIRST, so
    // a crash after this point can never leave PII behind — only a PII-free
    // pending tombstone that finalizePendingErasures() cleans up. phone is a
    // (non-sparse) unique index → use a per-user sentinel so multiple tombstones
    // don't collide; personal_id is $unset so the sparse-unique index drops it.
    const marked = await collection('users').findOneAndUpdate(
      { _id: userId },
      {
        $set: {
          name: 'Erased', name_lower: 'erased', phone: `erased-${userId}`, email: null,
          access_token_hash: null, refresh_token_hash: null, prev_refresh_token_hash: null,
          deletion_state: 'pending', deletion_requested_at: now, updated_at: now,
        },
        $unset: { personal_id: '' },
      },
      { returnDocument: 'after' }
    );
    const existed = unwrap(marked);
    if (!existed) return { deleted: 0, reportsScrubbed: scrub.modifiedCount };

    // Phase 2 — cascade deletes (idempotent) then drop the tombstone.
    await finalizePendingErasures(userId);
    return { deleted: 1, reportsScrubbed: scrub.modifiedCount };
  } catch (err) {
    logger.error('user_erasure_failed', { userId, error: err.message });
    throw err;
  }
}

/**
 * Finalize PDPO erasure tombstones (phase 2): emulate the FK cascades and
 * remove the (already PII-free) user doc. Idempotent — safe to re-run after a
 * crash. Pass a userId to finalize one, or omit to sweep every pending
 * tombstone (called from the retention job for crash recovery).
 */
async function finalizePendingErasures(userId) {
  const filter = userId
    ? { _id: userId }
    : { deletion_state: 'pending' };
  const pending = await collection('users').find(filter, { projection: { _id: 1 } }).limit(500).toArray();
  const ids = pending.map((p) => p._id);
  if (ids.length) {
    // Emulate the FK cascades in BULK: one deleteMany per related collection.
    // Dependents go concurrently; the user docs are deleted LAST so a crash
    // mid-cascade leaves the tombstone for the next sweep — same idempotent
    // guarantee, fewer ops/RU.
    await Promise.all([
      collection('account_links').deleteMany({ $or: [{ user_a_id: { $in: ids } }, { user_b_id: { $in: ids } }] }),
      collection('device_push_tokens').deleteMany({ user_id: { $in: ids } }),
      collection('safe_places').deleteMany({ created_by_user_id: { $in: ids } }),
    ]);
    await collection('users').deleteMany({ _id: { $in: ids } });
  }
  return { finalized: pending.length };
}

module.exports = {
  register,
  login,
  rotateRefreshToken,
  profileByPhone,
  updateProfile,
  setResponderProfile,
  eraseUser,
  finalizePendingErasures,
  publicUser,
  maskPersonalId,
};
