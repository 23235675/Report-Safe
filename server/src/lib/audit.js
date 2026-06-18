'use strict';

const crypto = require('crypto');
const { collection } = require('../db/mongo');

/**
 * Write one row to the audit_logs table (PDPO accountability: every
 * privileged government action is traceable).
 *
 * Fire-and-forget by design: an audit failure must never fail the action
 * itself, but it is logged loudly.
 *
 * NOTE: with the current single shared GOV_TOKEN there is no per-person
 * identity, so `actor` defaults to 'gov-token'. When auth moves to
 * per-user credentials, pass the real principal here.
 *
 * @param {{action:string, entity:string, entityId:string, actor?:string, details?:object}} entry
 */
function logAudit({ action, entity, entityId, actor = 'gov-token', details = null }) {
  collection('audit_logs').insertOne({
    _id: crypto.randomUUID(),
    action,
    entity,
    entity_id: entityId,
    actor,
    details: details ? JSON.stringify(details) : null,
    created_at: Date.now(),
  }).catch((err) => {
    console.error('[audit] FAILED to record audit entry:', action, entity, entityId, err);
  });
}

module.exports = { logAudit };
