'use strict';

/*
 * Shared helpers for the /api/admin/* sub-routers. admin.js was a 773-line
 * monolith with eight resource CRUDs; it's now split per resource (users.js,
 * reports.js, …) mounted by index.js. These helpers are the common bits.
 */

const crypto = require('crypto');
const { collection } = require('../../db/mongo');

/**
 * Normalise a value for COALESCE-style "update only if provided" semantics:
 * undefined, null, and EMPTY STRING all become null (so the field keeps its
 * existing value). Without this, the web admin form — which always submits
 * every field, including empty selects like role="" — would overwrite a column
 * with an empty string.
 */
const blank = (v) => (v === undefined || v === null || v === '' ? null : v);

// Allowed values for the former CHECK-constrained columns. Validating here turns
// a bad value into a clean 400 instead of letting an invalid status/role land in
// the database.
const VALID_ROLES         = ['citizen', 'volunteer', 'government', 'super_admin'];
const VALID_USER_TYPES    = ['mobile', 'web'];
const VALID_REPORT_STATUS = [
  'safe', 'injured', 'need_help', 'awaiting_response', 'potentially_missing',
  'missing', 'verified_missing', 'rescued', 'deceased',
];

// admin keeps its OWN mapId (vs lib/mongoMap) because it additionally drops the
// internal name_lower search helper from the response.
/** Map a stored doc's _id → id and drop the search-helper field. */
function mapId(doc) {
  if (!doc) return doc;
  const { _id, name_lower, ...rest } = doc;
  return { id: _id, ...rest };
}

/** Normalise a HK phone: keep last 8 digits, prefix +852. Null-safe. */
function normPhone(v) {
  if (blank(v) === null) return null;
  const digits = String(v).replace(/\D/g, '');
  return `+852${digits.slice(-8)}`;
}

/**
 * Emulate the FK side-effects of deleting a user (the SQL schema declared
 * ON DELETE CASCADE / SET NULL). MongoDB has no FKs, so we do it explicitly.
 */
async function cascadeUserRemoval(userId) {
  await collection('account_links').deleteMany({ $or: [{ user_a_id: userId }, { user_b_id: userId }] });
  await collection('device_push_tokens').deleteMany({ user_id: userId });
  await collection('safe_places').deleteMany({ created_by_user_id: userId });
  await collection('reports').updateMany({ user_id: userId }, { $set: { user_id: null } });
  await collection('reports').updateMany({ reported_for_user_id: userId }, { $set: { reported_for_user_id: null } });
  await collection('shelters').updateMany({ created_by_user_id: userId }, { $set: { created_by_user_id: null } });
}

async function auditLog(action, entity, entityId, actor, details) {
  try {
    await collection('audit_logs').insertOne({
      _id: crypto.randomUUID(), action, entity, entity_id: entityId, actor,
      details: details ? JSON.stringify(details) : null, created_at: Date.now(),
    });
  } catch (e) {
    console.error('[admin] audit log failed:', e.message);
  }
}

function actorLabel(req) {
  return req.admin ? `${req.admin.name} (${req.admin.phone})` : 'super_admin';
}

module.exports = {
  blank, VALID_ROLES, VALID_USER_TYPES, VALID_REPORT_STATUS,
  mapId, normPhone, cascadeUserRemoval, auditLog, actorLabel,
};
