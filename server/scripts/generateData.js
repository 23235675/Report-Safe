'use strict';

// Load server/.env relative to this file (not the CWD) so the script targets the
// same database however it is invoked.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const crypto = require('crypto');
const { connect, collection } = require('../src/db/mongo');

/** Insert documents in batches of 100 (replaces the former UNNEST bulk insert). */
async function insertInBatches(name, docs) {
  for (let i = 0; i < docs.length; i += 100) {
    await collection(name).insertMany(docs.slice(i, i + 100), { ordered: false });
  }
}

/*
 * Procedural data generation — populates reports, shelters, account_links, and
 * status_history with realistic synthetic data. All data is randomly generated,
 * not hardcoded. Designed to be run on-demand to fill the database with realistic
 * scenarios for testing and development.
 *
 * Usage: node src/db/generateData.js [reports=200] [shelters=50] [links=0.2]
 */

// ── Configuration ────────────────────────────────────────────────────────────

const REPORT_COUNT = Number(process.argv[2]) || 200;
const SHELTER_COUNT = Number(process.argv[3]) || 50;
const LINK_RATIO = Number(process.argv[4]) || 0.2; // 20% of users get family links

// HK landmark neighborhoods for realistic shelter locations
const HK_NEIGHBORHOODS = [
  { name: 'Central', lat: 22.2855, lng: 114.1577, latSpread: 0.01, lngSpread: 0.01 },
  { name: 'Wan Chai', lat: 22.2766, lng: 114.1752, latSpread: 0.012, lngSpread: 0.012 },
  { name: 'Causeway Bay', lat: 22.2808, lng: 114.1857, latSpread: 0.008, lngSpread: 0.008 },
  { name: 'Mong Kok', lat: 22.3193, lng: 114.1694, latSpread: 0.012, lngSpread: 0.008 },
  { name: 'Tsim Sha Tsui', lat: 22.2987, lng: 114.1718, latSpread: 0.01, lngSpread: 0.01 },
  { name: 'Sham Shui Po', lat: 22.3328, lng: 114.1644, latSpread: 0.012, lngSpread: 0.01 },
  { name: 'Kowloon Bay', lat: 22.3110, lng: 114.2001, latSpread: 0.01, lngSpread: 0.01 },
  { name: 'Sheung Wan', lat: 22.2852, lng: 114.1470, latSpread: 0.01, lngSpread: 0.008 },
  { name: 'Happy Valley', lat: 22.2706, lng: 114.1867, latSpread: 0.008, lngSpread: 0.008 },
  { name: 'North Point', lat: 22.2916, lng: 114.2051, latSpread: 0.01, lngSpread: 0.01 },
];

const SHELTER_TYPES = ['shelter', 'hospital', 'clinic', 'assembly'];
const SHELTER_NAMES = ['Community Centre', 'School Gym', 'Government Building', 'Sports Arena', 'Community Hall', 'Convention Centre', 'Community Hall'];
const STATUSES = ['safe', 'injured', 'need_help', 'awaiting_response', 'potentially_missing', 'missing', 'rescued'];
const STATUS_SOURCES = ['mobile', 'web', 'system'];

// ── Utilities ────────────────────────────────────────────────────────────────

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomCoord(base, spread) {
  return base + (Math.random() - 0.5) * 2 * spread;
}

// ── Report Generation ────────────────────────────────────────────────────────

async function generateReports(users, disasterIds) {
  console.log(`[generateData] generating ${REPORT_COUNT} reports from ${users.length} users...`);

  const now = Date.now();
  const reports = [];
  const statusHistories = [];

  for (let i = 0; i < REPORT_COUNT; i++) {
    const user = pick(users);
    const userId = user.id;
    const disasterId = Math.random() < 0.7 ? pick(disasterIds) : null;
    const reportId = crypto.randomUUID();
    const createdAt = now - randomBetween(1000 * 60 * 60, 7 * 24 * 60 * 60 * 1000); // last 7 days

    // Random location in HK bounds (22.1–22.5, 113.8–114.4)
    const lat = randomCoord(22.3, 0.2);
    const lng = randomCoord(114.1, 0.3);

    // Initial status (distribution: 60% safe, 20% injured, 15% need_help, 5% missing)
    const rand = Math.random();
    let status;
    if (rand < 0.6) status = 'safe';
    else if (rand < 0.8) status = 'injured';
    else if (rand < 0.95) status = 'need_help';
    else status = 'missing';

    // Use the user's REAL name + phone so reports are searchable and the admin
    // console shows real identities instead of "User N" placeholders.
    const name = user.name || `User ${i}`;
    const phone = user.phone || `+852${randomBetween(50000000, 99999999)}`;
    const medicalNotes = status === 'injured' ? pick(['minor cut', 'bruise', 'bleeding', null]) : null;
    const userType = Math.random() < 0.85 ? 'mobile' : 'web';

    // ~22% of reports are filed on someone else's behalf (a relative), the rest
    // are first-person. Gives the admin "Source" filter real variation.
    const isProxy = Math.random() < 0.22;
    const reportedBy = isProxy ? 'family' : 'self';
    const reporterName = isProxy ? `家人 ${randomBetween(1000, 9999)}` : null;

    reports.push({
      id: reportId,
      name,
      status,
      lat,
      lng,
      phone,
      medical_notes: medicalNotes,
      user_id: userId,
      user_type: userType,
      disaster_id: disasterId,
      reported_by: reportedBy,
      reporter_name: reporterName,
      created_at: createdAt,
    });

    // Initial status history entry (no prior status)
    statusHistories.push({
      id: crypto.randomUUID(),
      report_id: reportId,
      from_status: null,
      to_status: status,
      changed_by: userType,
      changed_at: createdAt,
      notes: 'Initial report',
    });

    // 30% of reports get a status change after creation
    if (Math.random() < 0.3) {
      const transitionDelay = randomBetween(5 * 60 * 1000, 2 * 24 * 60 * 60 * 1000);
      const newStatus = pick(STATUSES.filter((s) => s !== status));
      statusHistories.push({
        id: crypto.randomUUID(),
        report_id: reportId,
        from_status: status,
        to_status: newStatus,
        changed_by: pick(STATUS_SOURCES),
        changed_at: createdAt + transitionDelay,
        notes: `Status updated to ${newStatus}`,
      });
    }
  }

  // Insert reports (id → _id; mirror upsertReport's stored shape).
  await insertInBatches('reports', reports.map((r) => ({
    _id: r.id, name: r.name, name_lower: String(r.name || '').toLowerCase(),
    status: r.status, lat: r.lat, lng: r.lng, phone: r.phone,
    medical_notes: r.medical_notes, personal_id: null, user_id: r.user_id,
    user_type: r.user_type, disaster_id: r.disaster_id, reported_by: r.reported_by,
    reporter_name: r.reporter_name, reported_for_user_id: null, relay_count: 0,
    created_at: r.created_at, updated_at: r.created_at,
  })));

  // Insert status history.
  await insertInBatches('status_history', statusHistories.map((h) => ({
    _id: h.id, report_id: h.report_id, from_status: h.from_status, to_status: h.to_status,
    changed_by: h.changed_by, changed_at: h.changed_at, notes: h.notes,
  })));

  console.log(`[generateData] ✓ created ${reports.length} reports + ${statusHistories.length} status history entries`);
}

// ── Shelter Generation ───────────────────────────────────────────────────────

/** Great-circle distance in km between two lat/lng points (Haversine). */
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Find the disaster (if any) whose radius this point falls inside; nearest wins. */
function disasterForPoint(lat, lng, disasters) {
  let best = null;
  for (const d of disasters) {
    const dist = distanceKm(lat, lng, d.lat, d.lng);
    if (dist <= d.radius_km && (!best || dist < best.dist)) best = { id: d.id, dist };
  }
  return best ? best.id : null;
}

async function generateShelters(userIds, disasters = []) {
  console.log(`[generateData] generating ${SHELTER_COUNT} shelters...`);

  const shelters = [];
  const now = Date.now();

  for (let i = 0; i < SHELTER_COUNT; i++) {
    const neighborhood = pick(HK_NEIGHBORHOODS);
    const lat = randomCoord(neighborhood.lat, neighborhood.latSpread);
    const lng = randomCoord(neighborhood.lng, neighborhood.lngSpread);
    const capacity = randomBetween(50, 500);
    const currentCount = randomBetween(0, Math.floor(capacity * 0.8));
    const source = pick(['government', 'volunteer', 'citizen']);
    const shelterType = pick(SHELTER_TYPES);

    shelters.push({
      id: crypto.randomUUID(),
      created_by_user_id: source === 'citizen' ? pick(userIds) : null,
      name: `${neighborhood.name} ${pick(SHELTER_NAMES)}`,
      type: shelterType,
      lat,
      lng,
      // Link the shelter to the disaster whose radius it sits inside (so each
      // disaster shows its nearby shelters). Null if outside every radius.
      disaster_id: disasterForPoint(lat, lng, disasters),
      address: `${randomBetween(1, 999)} ${neighborhood.name}, Hong Kong`,
      phone: `+852${randomBetween(20000000, 99999999)}`,
      capacity,
      current_count: currentCount,
      source,
      contact_name: source === 'government' ? `官員 ${randomBetween(1000, 9999)}` : null,
      hours_open: '24/7',
      active: true,
      created_at: now - randomBetween(0, 30 * 24 * 60 * 60 * 1000),
    });
  }

  await insertInBatches('shelters', shelters.map((s) => ({
    _id: s.id, created_by_user_id: s.created_by_user_id, name: s.name, type: s.type,
    lat: s.lat, lng: s.lng, address: s.address, phone: s.phone, capacity: s.capacity,
    current_count: s.current_count, source: s.source, contact_name: s.contact_name,
    hours_open: s.hours_open, active: s.active, created_at: s.created_at,
    updated_at: s.created_at, disaster_id: s.disaster_id,
  })));

  console.log(`[generateData] ✓ created ${shelters.length} shelters`);
}

// ── Account Links (Family/Contact Linking) ───────────────────────────────────

async function generateLinks(userIds) {
  const linkCount = Math.floor(userIds.length * LINK_RATIO);
  console.log(`[generateData] generating ~${linkCount} family/contact links (${(LINK_RATIO * 100).toFixed(0)}% of users)...`);

  const links = [];
  const now = Date.now();

  // For each user selected, link them to 1-3 other random users
  for (let i = 0; i < linkCount; i++) {
    const userA = pick(userIds);
    const numLinks = randomBetween(1, 3);

    for (let j = 0; j < numLinks; j++) {
      let userB;
      do { userB = pick(userIds); } while (userB === userA);

      // Avoid duplicate links in both directions
      const key = [userA, userB].sort().join('|');
      if (links.some((l) => [l.user_a_id, l.user_b_id].sort().join('|') === key)) continue;

      const confirmed = Math.random() < 0.6; // 60% confirmed, 40% pending
      const confirmedAt = confirmed ? now - randomBetween(0, 30 * 24 * 60 * 60 * 1000) : null;

      links.push({
        id: crypto.randomUUID(),
        user_a_id: userA,
        user_b_id: userB,
        status: confirmed ? 'confirmed' : 'pending',
        confirmed_at: confirmedAt,
        created_at: confirmedAt || now - randomBetween(0, 7 * 24 * 60 * 60 * 1000),
      });
    }
  }

  if (links.length === 0) {
    console.log('[generateData] no links to insert (low ratio or small user set)');
    return;
  }

  await insertInBatches('account_links', links.map((l) => ({
    _id: l.id, user_a_id: l.user_a_id, user_b_id: l.user_b_id,
    status: l.status, confirmed_at: l.confirmed_at, created_at: l.created_at,
  })));

  console.log(`[generateData] ✓ created ${links.length} family/contact links`);
}

// ── Device Push Tokens ───────────────────────────────────────────────────────

async function generateDevices(users) {
  const deviceCount = Math.min(users.length, Number(process.argv[5]) || 60);
  console.log(`[generateData] generating ${deviceCount} device push tokens...`);

  const now = Date.now();
  // Real distribution builds only — 'expo' is a dev-client tool, not something an
  // end user's phone reports in production.
  const platforms = ['ios', 'android'];
  const rows = [];
  const used = new Set();

  for (let i = 0; i < deviceCount; i++) {
    // One token per user (real devices register at most a handful; one is plenty
    // for the admin console to show realistic radius-targeted push candidates).
    let user;
    do { user = pick(users); } while (used.has(user.id) && used.size < users.length);
    used.add(user.id);

    const platform = pick(platforms);
    rows.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      token: `demo-${platform}-${crypto.randomUUID()}`,
      platform,
      lat: randomCoord(22.3, 0.2),
      lng: randomCoord(114.1, 0.3),
      created_at: now - randomBetween(0, 14 * 24 * 60 * 60 * 1000),
    });
  }

  await insertInBatches('device_push_tokens', rows.map((r) => ({
    _id: r.id, user_id: r.user_id, token: r.token, platform: r.platform,
    lat: r.lat, lng: r.lng, created_at: r.created_at, updated_at: r.created_at,
  })));

  console.log(`[generateData] ✓ created ${rows.length} device push tokens`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function generateAll() {
  try {
    await connect(); // standalone script — establish the Mongo connection first
    // Fetch existing users (with name+phone so reports carry REAL identities,
    // not "User N" placeholders) and disasters (with geometry so shelters can be
    // linked to the disaster whose radius they fall inside).
    const userDocs = await collection('users').find({}).project({ _id: 1, name: 1, phone: 1 }).limit(100000).toArray();
    const disasterDocs = await collection('disasters').find({}).project({ _id: 1, lat: 1, lng: 1, radius_km: 1 }).toArray();

    const users = userDocs.map((u) => ({ id: u._id, name: u.name, phone: u.phone }));
    const userIds = users.map((r) => r.id);
    const disasters = disasterDocs.map((d) => ({ id: d._id, lat: d.lat, lng: d.lng, radius_km: d.radius_km }));
    const disasterIds = disasters.map((r) => r.id);

    if (userIds.length === 0 || disasterIds.length === 0) {
      console.error('[generateData] FATAL: database must be seeded first (npm run db:reset)');
      process.exit(1);
    }

    console.log(`[generateData] starting data generation...`);
    console.log(`  → ${userIds.length} users available`);
    console.log(`  → ${disasterIds.length} disasters available`);
    console.log('');

    await generateReports(users, disasterIds);
    await generateShelters(userIds, disasters);
    await generateLinks(userIds);
    await generateDevices(users);

    console.log('');
    console.log('[generateData] ✓ complete!');
    process.exit(0);
  } catch (err) {
    console.error('[generateData] FATAL:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  generateAll();
}

module.exports = { generateReports, generateShelters, generateLinks, generateDevices };
