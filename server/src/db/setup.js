'use strict';

const { connect, getDb, closeDb } = require('./mongo');

/*
 * Schema bootstrap for MongoDB / Azure Cosmos DB for MongoDB.
 *
 * Unlike SQL there is no CREATE TABLE — collections are created on first write.
 * We still create them explicitly (so indexes can be built up-front) and define
 * every index the query layer relies on. Geo queries use a lat/lng bounding-box
 * prefilter + JS haversine (see services/reportStore.js), so we index (lat,lng)
 * rather than using a 2dsphere/GeoJSON field — keeping the same math the SQL
 * version used and staying fully compatible with Cosmos RU-based.
 *
 * COSMOS NOTE: unique indexes must be created while the collection is empty
 * (true on a fresh migration). createIndex is idempotent across boots.
 */

// Every collection the app uses. _id carries the former TEXT PRIMARY KEY
// (report/user/disaster UUIDs are client- or server-generated strings).
const COLLECTIONS = [
  'reports',
  'disasters',
  'shelters',
  'status_history',
  'rescue_requests',
  'team_assignments',
  'missing_person_cases',
  'audit_logs',
  'users',
  'account_links',
  'safe_places',
  'device_push_tokens',
];

/** Ensure a collection exists (ignore "already exists"). */
async function ensureCollection(db, name) {
  try {
    await db.createCollection(name);
  } catch (err) {
    // 48 = NamespaceExists (collection already created on a prior boot).
    if (err.code !== 48 && !/exists/i.test(err.message || '')) throw err;
  }
}

async function setup() {
  await connect();
  const db = getDb();

  for (const name of COLLECTIONS) {
    await ensureCollection(db, name);
  }

  // ── reports ──────────────────────────────────────────────────────
  // name_lower is a denormalised lowercase copy of name; the query layer keeps
  // it in sync on write so case-insensitive search uses an index instead of a
  // collation scan (Cosmos RU-based has no $text index).
  await db.collection('reports').createIndexes([
    { key: { name_lower: 1 }, name: 'idx_reports_name' },
    { key: { status: 1 }, name: 'idx_reports_status' },
    { key: { lat: 1, lng: 1 }, name: 'idx_reports_lat_lng' },
    { key: { updated_at: 1 }, name: 'idx_reports_updated' },
    { key: { user_id: 1 }, name: 'idx_reports_user' },
    { key: { user_type: 1 }, name: 'idx_reports_user_type' },
    { key: { personal_id: 1 }, name: 'idx_reports_personal_id' },
    { key: { reported_for_user_id: 1 }, name: 'idx_reports_reported_for' },
  ]);

  // ── disasters ────────────────────────────────────────────────────
  await db.collection('disasters').createIndexes([
    { key: { active: 1 }, name: 'idx_disasters_active' },
    { key: { lat: 1, lng: 1 }, name: 'idx_disasters_lat_lng' },
  ]);

  // ── shelters ─────────────────────────────────────────────────────
  await db.collection('shelters').createIndexes([
    { key: { active: 1 }, name: 'idx_shelters_active' },
    { key: { lat: 1, lng: 1 }, name: 'idx_shelters_lat_lng' },
    { key: { disaster_id: 1 }, name: 'idx_shelters_disaster' },
    { key: { source: 1 }, name: 'idx_shelters_source' },
  ]);

  // ── status_history (write-only audit trail; never read by the app) ─
  await db.collection('status_history').createIndex({ report_id: 1 }, { name: 'idx_status_hist_report' });

  // ── rescue_requests / team_assignments ───────────────────────────
  await db.collection('rescue_requests').createIndex({ report_id: 1 }, { name: 'idx_rescue_req_report' });
  await db.collection('team_assignments').createIndex({ report_id: 1 }, { name: 'idx_team_assign_report' });

  // ── missing_person_cases ─────────────────────────────────────────
  await db.collection('missing_person_cases').createIndex({ case_status: 1 }, { name: 'idx_missing_case_status' });

  // ── audit_logs ───────────────────────────────────────────────────
  await db.collection('audit_logs').createIndex({ entity: 1, entity_id: 1 }, { name: 'idx_audit_entity' });

  // ── users ────────────────────────────────────────────────────────
  // phone is globally unique. personal_id (HKID) is unique among accounts that
  // have one — `sparse` exempts legacy accounts that omit the field entirely
  // (the query layer omits personal_id rather than storing null, so sparse
  // applies). access/refresh token hashes are looked up on every authed request.
  await db.collection('users').createIndexes([
    { key: { phone: 1 }, name: 'idx_users_phone', unique: true },
    { key: { user_type: 1 }, name: 'idx_users_type' },
    { key: { personal_id: 1 }, name: 'idx_users_personal_id', unique: true, sparse: true },
    { key: { access_token_hash: 1 }, name: 'idx_users_access_token' },
    { key: { refresh_token_hash: 1 }, name: 'idx_users_refresh_token' },
  ]);

  // ── account_links ────────────────────────────────────────────────
  // One link per ordered (a,b) pair — the compound unique mirrors the SQL
  // UNIQUE(user_a_id, user_b_id) the upsert relies on.
  await db.collection('account_links').createIndexes([
    { key: { user_a_id: 1, user_b_id: 1 }, name: 'idx_links_pair', unique: true },
    { key: { user_a_id: 1 }, name: 'idx_links_user_a' },
    { key: { user_b_id: 1 }, name: 'idx_links_user_b' },
  ]);

  // ── safe_places ──────────────────────────────────────────────────
  await db.collection('safe_places').createIndexes([
    { key: { status: 1 }, name: 'idx_safe_places_status' },
    { key: { disaster_id: 1 }, name: 'idx_safe_places_disaster' },
    { key: { active: 1 }, name: 'idx_safe_places_active' },
    { key: { created_by_user_id: 1 }, name: 'idx_safe_places_creator' },
  ]);

  // ── device_push_tokens ───────────────────────────────────────────
  // token is unique (one row per device handle — the upsert target).
  await db.collection('device_push_tokens').createIndexes([
    { key: { token: 1 }, name: 'idx_device_tokens_token', unique: true },
    { key: { lat: 1, lng: 1 }, name: 'idx_device_tokens_lat_lng' },
    { key: { user_id: 1 }, name: 'idx_device_tokens_user' },
  ]);

  console.log('[db/setup] MongoDB collections + indexes ready');
}

module.exports = { setup, closeDb, COLLECTIONS };
