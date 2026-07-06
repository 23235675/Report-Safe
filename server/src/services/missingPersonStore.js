'use strict';

/*
 * Missing-person case persistence. The escalation engine promotes silent
 * reports to `potentially_missing`; these cases track the follow-up. All
 * Mongo access for the `missing_person_cases` collection.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { mapId, unwrap, pickProvided } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');

/** List cases — a specific status, or the open ones (active/investigating) by default. */
async function list(status) {
  const filter = status ? { case_status: String(status) } : { case_status: { $in: ['active', 'investigating'] } };
  const docs = await collection('missing_person_cases')
    .find(filter).sort({ created_at: -1 }).limit(500).toArray();
  return docs.map(mapId);
}

/** Open a case (optionally linked to a report). */
async function open(fields, openedBy) {
  const now = Date.now();
  const doc = {
    _id: crypto.randomUUID(),
    report_id: fields.report_id ?? null,
    name: fields.name,
    notes: fields.notes ?? null,
    last_seen_lat: fields.last_seen_lat ?? null,
    last_seen_lng: fields.last_seen_lng ?? null,
    case_status: 'active',
    opened_by: openedBy,
    created_at: now,
    updated_at: now,
  };
  await collection('missing_person_cases').insertOne(doc);
  return mapId(doc);
}

/** Update status / notes. Returns the applied $set for the audit trail. */
async function update(id, fields) {
  const set = { ...pickProvided(fields, ['case_status', 'notes']), updated_at: Date.now() };
  const res = await collection('missing_person_cases').findOneAndUpdate(
    { _id: id }, { $set: set }, { returnDocument: 'after' }
  );
  const doc = unwrap(res);
  if (!doc) throw new HttpError(404, 'Case not found');
  return { data: mapId(doc), set };
}

/** Soft-close: case_status='closed'. 404 for an unknown case. */
async function close(id) {
  const res = await collection('missing_person_cases').findOneAndUpdate(
    { _id: id },
    { $set: { case_status: 'closed', updated_at: Date.now() } },
    { returnDocument: 'after' }
  );
  if (!unwrap(res)) throw new HttpError(404, 'Case not found');
}

module.exports = { list, open, update, close };
