'use strict';

/*
 * Shelter persistence: list (radius or plain), detail, create, partial
 * update, soft-delete. All Mongo access for the `shelters` collection.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { findWithinRadius } = require('../lib/geo');
const { mapId, unwrap, pickProvided } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');

const UPDATABLE = ['name', 'capacity', 'current_count', 'phone', 'address', 'contact_name', 'hours_open', 'active'];

/**
 * Active shelters, optionally filtered by disaster/source. With coordinates:
 * radius query sorted by distance (uncapped — the shelter set is small).
 * Without: alphabetical.
 */
async function list({ lat, lng, radius, disaster_id, source }) {
  const filter = { active: true };
  if (disaster_id) filter.disaster_id = disaster_id;
  if (source) filter.source = source;

  if (lat != null && lng != null) {
    return findWithinRadius('shelters', { lat, lng, radiusKm: radius, filter, cap: null, map: mapId });
  }
  const docs = await collection('shelters').find(filter).sort({ name: 1 }).toArray();
  return docs.map(mapId);
}

async function get(id) {
  const doc = await collection('shelters').findOne({ _id: id });
  if (!doc) throw new HttpError(404, 'Shelter not found');
  return mapId(doc);
}

async function create(f) {
  const now = Date.now();
  const doc = {
    _id: crypto.randomUUID(),
    name: f.name, type: f.type, source: f.source, lat: f.lat, lng: f.lng,
    capacity: f.capacity ?? null, current_count: f.current_count ?? 0,
    address: f.address ?? null, phone: f.phone ?? null, contact_name: f.contact_name ?? null,
    hours_open: f.hours_open ?? null, disaster_id: f.disaster_id ?? null, active: true,
    created_at: now, updated_at: now,
  };
  await collection('shelters').insertOne(doc);
  return mapId(doc);
}

async function update(id, fields) {
  const set = { ...pickProvided(fields, UPDATABLE), updated_at: Date.now() };
  const res = await collection('shelters').findOneAndUpdate(
    { _id: id }, { $set: set }, { returnDocument: 'after' }
  );
  const doc = unwrap(res);
  if (!doc) throw new HttpError(404, 'Shelter not found');
  return mapId(doc);
}

/** Soft-delete: shelters are deactivated, never removed (idempotent). */
async function deactivate(id) {
  await collection('shelters').updateOne(
    { _id: id }, { $set: { active: false, updated_at: Date.now() } }
  );
}

module.exports = { list, get, create, update, deactivate };
