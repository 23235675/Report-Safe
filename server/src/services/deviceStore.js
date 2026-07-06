'use strict';

/*
 * Device push-token registry persistence. One row per native FCM/APNs handle;
 * location refreshed on every registration so disaster targeting stays
 * current. All Mongo access for the `device_push_tokens` collection.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');

/**
 * Upsert by token (the former ON CONFLICT (token) DO UPDATE). user_id uses
 * COALESCE semantics: a provided id overwrites, an absent one keeps prior.
 * Safe against a lost insert race on the unique token index.
 */
async function upsert({ token, platform, lat, lng, userId }) {
  const now = Date.now();
  const setOnInsert = { _id: crypto.randomUUID(), created_at: now };
  const set = { platform, lat: lat ?? null, lng: lng ?? null, updated_at: now };
  if (userId != null) set.user_id = userId; else setOnInsert.user_id = null;

  const tokens = collection('device_push_tokens');
  try {
    await tokens.updateOne({ token }, { $setOnInsert: setOnInsert, $set: set }, { upsert: true });
  } catch (err) {
    // Lost an insert race on the unique token → the row now exists; update it.
    if (err.code === 11000) await tokens.updateOne({ token }, { $set: set });
    else throw err;
  }
}

/** The user a handle is registered to (null user_id = anonymous device), or undefined if absent. */
async function findOwner(token) {
  const doc = await collection('device_push_tokens').findOne({ token }, { projection: { user_id: 1 } });
  return doc || null;
}

async function remove(token) {
  await collection('device_push_tokens').deleteOne({ token });
}

module.exports = { upsert, findOwner, remove };
