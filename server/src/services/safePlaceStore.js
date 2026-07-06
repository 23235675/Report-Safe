'use strict';

/*
 * Citizen-submitted refuge locations. Reading is public (these are locations,
 * not personal data); submissions start `pending` until a gov/volunteer
 * reviews them. All Mongo access for the `safe_places` collection.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { findWithinRadius } = require('../lib/geo');
const { mapId, unwrap } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');

// Public list projection — never exposes the submitter, status, or review fields.
const PUBLIC_PROJECTION = { name: 1, lat: 1, lng: 1, description: 1, capacity: 1, disaster_id: 1, active: 1, created_at: 1 };

/** Approved, active places — by radius when coordinates are given, else newest first. */
async function listApproved({ lat, lng, radius }) {
  const filter = { active: true, status: 'approved' };

  if (lat != null && lng != null) {
    return findWithinRadius('safe_places', {
      lat, lng, radiusKm: radius, filter, project: PUBLIC_PROJECTION, cap: null, map: mapId,
    });
  }
  const docs = await collection('safe_places').find(filter).project(PUBLIC_PROJECTION).sort({ created_at: -1 }).toArray();
  return docs.map(mapId);
}

/** A citizen submission — starts pending. Unknown disaster_id is a 400 (was FK 23503). */
async function submit(userId, { name, lat, lng, description, capacity, disaster_id }) {
  if (disaster_id) {
    const known = await collection('disasters').findOne({ _id: disaster_id }, { projection: { _id: 1 } });
    if (!known) throw new HttpError(400, 'Unknown disaster_id.');
  }
  const doc = {
    _id: crypto.randomUUID(), created_by_user_id: userId, name, lat, lng,
    description: description ?? null, capacity: capacity ?? null,
    disaster_id: disaster_id ?? null, active: true, status: 'pending',
    reviewed_by: null, reviewed_at: null, created_at: Date.now(),
  };
  await collection('safe_places').insertOne(doc);
  return mapId(doc);
}

/** Moderation queue: pending submissions with the submitter's name/phone joined. */
async function pendingQueue() {
  const places = await collection('safe_places').find({ status: 'pending' }).sort({ created_at: 1 }).toArray();
  const creatorIds = [...new Set(places.map((p) => p.created_by_user_id).filter(Boolean))];
  const users = creatorIds.length
    ? await collection('users').find({ _id: { $in: creatorIds } }).project({ _id: 1, name: 1, phone: 1 }).toArray()
    : [];
  const byId = new Map(users.map((u) => [u._id, u]));

  return places.map((p) => {
    const u = p.created_by_user_id ? byId.get(p.created_by_user_id) : null; // LEFT JOIN
    return {
      id: p._id, name: p.name, lat: p.lat, lng: p.lng, description: p.description,
      capacity: p.capacity, disaster_id: p.disaster_id, created_at: p.created_at,
      submitter_name: u ? u.name : null,
      submitter_phone: u ? u.phone : null,
    };
  });
}

/** Approve or reject a PENDING submission (already-reviewed ones 404). */
async function review(id, status, reviewer) {
  const res = await collection('safe_places').findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status, reviewed_by: reviewer, reviewed_at: Date.now() } },
    { returnDocument: 'after' }
  );
  const doc = unwrap(res);
  if (!doc) throw new HttpError(404, 'Pending safe place not found (already reviewed?)');
  return mapId(doc);
}

module.exports = { listApproved, submit, pendingQueue, review };
