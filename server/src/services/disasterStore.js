'use strict';

/*
 * Disaster read/lifecycle persistence for the public + gov routes. Creation
 * goes through triggerEngine (dedupe + alert fan-out); this store owns the
 * plain reads and the deactivate lifecycle write.
 */

const { collection } = require('../db/mongo');
const { mapId, unwrap } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');

/** All currently active disasters, newest first. */
async function listActive() {
  const docs = await collection('disasters')
    .find({ active: true })
    .sort({ started_at: -1 })
    .toArray();
  return docs.map(mapId);
}

/**
 * End an active disaster: active=false + ended_at. Once inactive, the
 * partial-unique (type, active) index frees the type to be re-triggered.
 */
async function deactivate(id) {
  const res = await collection('disasters').findOneAndUpdate(
    { _id: id, active: true },
    { $set: { active: false, ended_at: Date.now() } },
    { returnDocument: 'after' }
  );
  const doc = unwrap(res);
  if (!doc) throw new HttpError(404, 'No active disaster with that id.');
  return mapId(doc);
}

module.exports = { listActive, deactivate };
