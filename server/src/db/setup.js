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
  'missing_person_cases', // used by /api/missing-persons (B19)
  'audit_logs',
  'users',
  'account_links',
  'safe_places',
  'device_push_tokens',
  'incidents',           // CFR: 999/CAD point dispatches needing nearby responders
  'incident_responses',  // CFR: one row per responder per incident
  'aed_locations',       // CFR: public AED registry (seed now, gov import later)
];

// L2: collections that were created + indexed but never read/written. Dropped on
// boot (idempotent) so they stop wasting Cosmos RU + index budget. missing_person_cases
// is NOT here — it's now live (B19).
const DEAD_COLLECTIONS = ['rescue_requests', 'team_assignments'];

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

  // L2: drop dead collections from existing deployments (idempotent, no-op if absent).
  for (const name of DEAD_COLLECTIONS) {
    await db.collection(name).drop().catch(() => {});
  }

  // ── Cosmos order-by guard ────────────────────────────────────────
  // Azure Cosmos DB for MongoDB (RU-based) only allows find().sort() on an
  // INDEXED path. Rather than a wildcard index on EVERY field (M5: that
  // amplifies write-RU and bloats the index on the write-hot collections),
  // each field a route actually sorts on is indexed explicitly below. Computed
  // sort keys used in aggregation pipelines ($sort on $addFields output, e.g.
  // admin reports/devices) are engine-side and never needed the wildcard.
  // Drop any pre-existing wildcard index left over from before M5.
  for (const name of COLLECTIONS) {
    await db.collection(name).dropIndex('idx_wildcard').catch(() => {});
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
  // Partial-unique (type) among ACTIVE disasters (M4/B11): a DB-level guard
  // against two instances / two rapid triggers both inserting the same active
  // hazard. The app-level findDuplicateActive (type + 30km) still runs first;
  // this catches the race it can't. Deactivating (active=false) drops the row
  // from the filter, so the same type can be re-triggered later.
  await db.collection('disasters').createIndexes([
    { key: { active: 1 }, name: 'idx_disasters_active' },
    { key: { lat: 1, lng: 1 }, name: 'idx_disasters_lat_lng' },
    { key: { started_at: -1 }, name: 'idx_disasters_started' }, // GET / sort
  ]);
  // Partial-unique (type) among ACTIVE disasters (M4). Best-effort: an EXISTING
  // database may already hold two active disasters of the same type, which would
  // make this index build fail — don't let that block startup. The app-level
  // findDuplicateActive guard still prevents new duplicates; the index is just a
  // race backstop. (Clean up dup actives, then it builds on the next boot.)
  try {
    await db.collection('disasters').createIndex(
      { type: 1 },
      { name: 'idx_disasters_type_active_unique', unique: true, partialFilterExpression: { active: true } }
    );
  } catch (err) {
    console.warn('[db/setup] disaster partial-unique index skipped (existing duplicate active types?):', err.message);
  }

  // ── shelters ─────────────────────────────────────────────────────
  await db.collection('shelters').createIndexes([
    { key: { active: 1 }, name: 'idx_shelters_active' },
    { key: { lat: 1, lng: 1 }, name: 'idx_shelters_lat_lng' },
    { key: { disaster_id: 1 }, name: 'idx_shelters_disaster' },
    { key: { source: 1 }, name: 'idx_shelters_source' },
    { key: { name: 1 }, name: 'idx_shelters_name' }, // non-geo list sort
  ]);

  // ── status_history (write-only audit trail; never read by the app) ─
  await db.collection('status_history').createIndex({ report_id: 1 }, { name: 'idx_status_hist_report' });

  // ── missing_person_cases ─────────────────────────────────────────
  await db.collection('missing_person_cases').createIndexes([
    { key: { case_status: 1 }, name: 'idx_missing_case_status' },
    { key: { created_at: -1 }, name: 'idx_missing_created' }, // list sort
  ]);

  // ── audit_logs ───────────────────────────────────────────────────
  await db.collection('audit_logs').createIndexes([
    { key: { entity: 1, entity_id: 1 }, name: 'idx_audit_entity' },
    { key: { created_at: -1 }, name: 'idx_audit_created' }, // admin audit list sort
  ]);

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
    { key: { prev_refresh_token_hash: 1 }, name: 'idx_users_prev_refresh' }, // H4 reuse-detection lookup
    { key: { created_at: -1 }, name: 'idx_users_created' }, // admin users list sort
    { key: { name: 1 }, name: 'idx_users_name' }, // H7 anchored name-prefix search
  ]);
  // CFR: the incident matcher queries { responder_opt_in:true, responder_skills:<skill> }
  // on every dispatch. PARTIAL on opt-in keeps the index tiny (only responders —
  // a small subset) and turns a full users scan into an index lookup. Best-effort:
  // a Cosmos tier without partial-index support won't block boot (query still
  // works, just scans) — same defensive pattern as the disasters partial index.
  try {
    await db.collection('users').createIndex(
      { responder_opt_in: 1, responder_skills: 1 },
      { name: 'idx_users_responder', partialFilterExpression: { responder_opt_in: true } }
    );
  } catch (err) {
    console.warn('[db/setup] responder partial index skipped:', err.message);
  }

  // ── account_links ────────────────────────────────────────────────
  // One link per ordered (a,b) pair — the compound unique mirrors the SQL
  // UNIQUE(user_a_id, user_b_id) the upsert relies on.
  await db.collection('account_links').createIndexes([
    { key: { user_a_id: 1, user_b_id: 1 }, name: 'idx_links_pair', unique: true },
    { key: { user_a_id: 1 }, name: 'idx_links_user_a' },
    { key: { user_b_id: 1 }, name: 'idx_links_user_b' },
    { key: { created_at: -1 }, name: 'idx_links_created' }, // admin links list sort
  ]);

  // ── safe_places ──────────────────────────────────────────────────
  await db.collection('safe_places').createIndexes([
    { key: { status: 1 }, name: 'idx_safe_places_status' },
    { key: { disaster_id: 1 }, name: 'idx_safe_places_disaster' },
    { key: { active: 1 }, name: 'idx_safe_places_active' },
    { key: { created_by_user_id: 1 }, name: 'idx_safe_places_creator' },
    { key: { created_at: -1 }, name: 'idx_safe_places_created' }, // list sort
  ]);

  // ── device_push_tokens ───────────────────────────────────────────
  // token is unique (one row per device handle — the upsert target).
  await db.collection('device_push_tokens').createIndexes([
    { key: { token: 1 }, name: 'idx_device_tokens_token', unique: true },
    { key: { lat: 1, lng: 1 }, name: 'idx_device_tokens_lat_lng' },
    { key: { user_id: 1 }, name: 'idx_device_tokens_user' },
    { key: { updated_at: -1 }, name: 'idx_device_tokens_updated' }, // admin devices list sort
  ]);

  // ── incidents (CFR) ──────────────────────────────────────────────
  // 999/CAD point dispatches. Same lat/lng bounding-box geo pattern as the
  // other collections; status drives the active-board filter.
  await db.collection('incidents').createIndexes([
    { key: { status: 1 }, name: 'idx_incidents_status' },
    { key: { lat: 1, lng: 1 }, name: 'idx_incidents_lat_lng' },
    { key: { created_at: -1 }, name: 'idx_incidents_created' }, // board sort
  ]);

  // ── incident_responses (CFR) ─────────────────────────────────────
  // One response row per (incident, responder). The compound unique mirrors the
  // upsert target so a responder can't create two rows for the same incident.
  await db.collection('incident_responses').createIndexes([
    { key: { incident_id: 1 }, name: 'idx_inc_resp_incident' },
    { key: { incident_id: 1, user_id: 1 }, name: 'idx_inc_resp_pair', unique: true },
    { key: { user_id: 1 }, name: 'idx_inc_resp_user' },
  ]);

  // ── aed_locations (CFR) ──────────────────────────────────────────
  await db.collection('aed_locations').createIndexes([
    { key: { lat: 1, lng: 1 }, name: 'idx_aed_lat_lng' },
    { key: { active: 1 }, name: 'idx_aed_active' },
  ]);

  console.log('[db/setup] MongoDB collections + indexes ready');
}

module.exports = { setup, closeDb, COLLECTIONS };
