'use strict';

/*
 * fillDatabase.js — populate every collection with realistic, fully-linked data
 * generated AT RUNTIME from what already exists in the database (no hardcoded
 * relationships). All foreign keys reference real _ids read back from Mongo:
 *   reports.user_id / disaster_id        → real users / disasters
 *   account_links.user_a_id/user_b_id    → real users
 *   device_push_tokens.user_id           → real users
 *   status_history.report_id             → real reports
 *   rescue_requests.report_id            → real reports
 *   team_assignments.report_id           → real reports
 *   missing_person_cases.report_id/user_id → real reports / users
 *   safe_places.created_by_user_id       → real users
 *   shelters.disaster_id                 → disaster whose radius the point is in
 *
 * Cosmos DB for MongoDB (RU-based, free tier 400 RU/s per collection) throttles
 * fast bulk writes with 429 (code 16500). retryWrites is OFF, so we retry the
 * throttled docs ourselves with exponential backoff — otherwise inserts are
 * silently dropped (the reason a prior 10k-user seed left only 35 rows).
 *
 * Usage: node src/db/fillDatabase.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const crypto = require('crypto');
const { connect, collection, closeDb } = require('../src/db/mongo');

// ── Targets ──────────────────────────────────────────────────────────────────
const TARGET = {
  users: 1000,
  reports: 50,
  shelters: 30,
  account_links: 40,
  device_push_tokens: 40,
  rescue_requests: 28,
  team_assignments: 22,
  missing_person_cases: 18,
  safe_places: 26,
  audit_logs: 35,
  disasters_total: 12, // existing 3 + 9 new
};
const ADMIN_PHONE = process.env.SUPER_ADMIN_PHONE || '+85212345678';

// ── Random helpers ───────────────────────────────────────────────────────────
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;
const coord = (base, spread) => base + (Math.random() - 0.5) * 2 * spread;
const uuid = () => crypto.randomUUID();
const now = Date.now();

const SURNAMES = ['Chan', 'Wong', 'Lee', 'Cheung', 'Lam', 'Ng', 'Ho', 'Tsang', 'Yip', 'Lau', 'Chow', 'Kwok', 'Leung', 'Tang', 'Cheng'];
const GIVEN = ['Tai Man', 'Mei Ling', 'Ka Wai', 'Siu Fung', 'Ka Ho', 'Wai Kit', 'Sze Wan', 'Ho Yin', 'Ka Man', 'Chun Hei', 'Wing Yan', 'Ka Yan', 'Pui Shan', 'Cheuk Hei', 'Hoi Ying'];
const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com.hk', 'hotmail.com', 'outlook.com'];
const HK_AREAS = [
  { name: 'Central', lat: 22.2855, lng: 114.1577, s: 0.01 },
  { name: 'Wan Chai', lat: 22.2766, lng: 114.1752, s: 0.012 },
  { name: 'Causeway Bay', lat: 22.2808, lng: 114.1857, s: 0.008 },
  { name: 'Mong Kok', lat: 22.3193, lng: 114.1694, s: 0.01 },
  { name: 'Tsim Sha Tsui', lat: 22.2987, lng: 114.1718, s: 0.01 },
  { name: 'Sham Shui Po', lat: 22.3328, lng: 114.1644, s: 0.012 },
  { name: 'Kowloon Bay', lat: 22.3110, lng: 114.2001, s: 0.01 },
  { name: 'Sheung Wan', lat: 22.2852, lng: 114.1470, s: 0.01 },
  { name: 'North Point', lat: 22.2916, lng: 114.2051, s: 0.01 },
  { name: 'Sha Tin', lat: 22.3820, lng: 114.1880, s: 0.015 },
];
const SHELTER_NAMES = ['Community Centre', 'School Gym', 'Government Building', 'Sports Arena', 'Community Hall', 'Convention Centre', 'Sports Centre'];
const SHELTER_TYPES = ['shelter', 'hospital', 'clinic', 'assembly'];

function hkPhone() { return `+852${rnd(50000000, 99999999)}`; }
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371, dLat = ((bLat - aLat) * Math.PI) / 180, dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function disasterForPoint(lat, lng, disasters) {
  let best = null;
  for (const d of disasters) {
    const dist = distanceKm(lat, lng, d.lat, d.lng);
    if (dist <= d.radius_km && (!best || dist < best.dist)) best = { id: d.id, dist };
  }
  return best ? best.id : null;
}

// ── 429-aware batched insert ─────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isThrottle(err) {
  if (!err) return false;
  const code = err.code ?? err.codeName;
  if (code === 16500 || code === 429) return true;
  if (err.RetryAfterMs != null) return true;
  return /16500|RetryAfterMs|RequestRateTooLarge|TooManyRequests|rate too large|Batch write error/i.test(err.message || '');
}

/** Run a write op, retrying on 429 (honouring RetryAfterMs when present). */
async function withRetry(fn, label, max = 15) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (!isThrottle(err) || attempt >= max) throw err;
      const ra = Number(err.RetryAfterMs) || 0;
      await sleep(Math.max(ra, Math.min(150 * 2 ** attempt, 6000)) + rnd(0, 200));
    }
  }
}

/**
 * Delete in small paced chunks (page _ids, delete by _id). A single big
 * deleteMany on a 400 RU/s collection throttles indefinitely; chunks of ~50
 * each retry cheaply and converge.
 */
async function safeDelete(name, filter = {}, chunk = 50) {
  const coll = collection(name);
  for (;;) {
    const ids = await withRetry(
      () => coll.find(filter).project({ _id: 1 }).limit(chunk).toArray(),
      `scan ${name}`
    );
    if (!ids.length) break;
    await withRetry(
      () => coll.deleteMany({ _id: { $in: ids.map((d) => d._id) } }),
      `delete ${name}`
    );
    await sleep(120);
  }
}

/**
 * Insert all docs completely. On a 429 throttle the WHOLE batch is retried after
 * backoff — docs that already landed return benign duplicate-key (11000) and are
 * skipped, so retries converge to "every insertable doc inserted" rather than
 * trusting Cosmos's (incomplete) writeErrors list. Idempotent on stable _ids.
 */
async function safeInsert(name, docs) {
  const coll = collection(name);
  for (const doc of docs) {
    try {
      await withRetry(() => coll.insertOne(doc), `insert ${name}`);
    } catch (err) {
      if ((err.code ?? err.codeName) === 11000) continue; // dup-key → already present, skip
      throw err;
    }
    // Pace at ~60ms (≈16 writes/s). With the wildcard indexes dropped during the
    // load, each write is cheap (~5 RU), so this stays well under 400 RU/s and
    // never enters the sustained-throttle state that crashes the v7 driver.
    await sleep(60);
  }
  return docs.length;
}

/**
 * Insert AND verify: Cosmos can drop throttled docs without surfacing them in
 * writeErrors, so we re-read which _ids actually persisted and re-insert the
 * rest until the database matches the intended set (or we run out of rounds).
 */
async function ensureInserted(name, docs, rounds = 8) {
  const coll = collection(name);
  let remaining = docs;
  for (let r = 0; r < rounds && remaining.length; r++) {
    await safeInsert(name, remaining);
    const ids = remaining.map((d) => d._id);
    const present = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      const found = await withRetry(
        () => coll.find({ _id: { $in: ids.slice(i, i + 200) } }).project({ _id: 1 }).toArray(),
        `verify ${name}`
      );
      found.forEach((d) => present.add(d._id));
    }
    remaining = remaining.filter((d) => !present.has(d._id));
    if (remaining.length) await sleep(400);
  }
  if (remaining.length) throw new Error(`${name}: ${remaining.length} docs failed to persist after ${rounds} rounds`);
  return docs.length;
}

// ── Generators ───────────────────────────────────────────────────────────────
function makeUsers(n) {
  // phone + personal_id carry UNIQUE indexes — derive them from the row index so
  // 1000 rows never collide (random 8-digit phones would by the birthday problem).
  const out = [];
  const idLetters = 'ABCKMNPRSTVWXYZ'.split('');
  for (let i = 0; i < n; i++) {
    const name = `${pick(GIVEN)} ${pick(SURNAMES)}`;
    const roleR = Math.random();
    const role = roleR < 0.95 ? 'citizen' : roleR < 0.99 ? 'volunteer' : 'government';
    const createdAt = now - rnd(0, 90 * 864e5);
    out.push({
      _id: uuid(), phone: `+852${50000000 + i}`, name,
      email: chance(0.4) ? `${name.replace(/[^a-z]/gi, '').toLowerCase()}${i}@${pick(EMAIL_DOMAINS)}` : null,
      // Always assign a UNIQUE personal_id. Cosmos does not honour MongoDB sparse
      // semantics — every doc missing the field counts as the same `null`, and a
      // unique index permits only one null, so omitting it makes all-but-one
      // collide on duplicate-null. A unique HKID per row sidesteps that entirely.
      personal_id: `${idLetters[i % idLetters.length]}${100000 + i}(${i % 10})`,
      user_type: chance(0.85) ? 'mobile' : 'web', role,
      privacy_consent: chance(0.8), created_at: createdAt, updated_at: createdAt,
    });
  }
  return out;
}

function makeDisasters(existing, want) {
  const need = Math.max(0, want - existing.length);
  const types = [
    { type: 'typhoon', severity: 'severe' }, { type: 'flood', severity: 'high' },
    { type: 'landslide', severity: 'high' }, { type: 'fire', severity: 'moderate' },
    { type: 'earthquake', severity: 'moderate' }, { type: 'storm_surge', severity: 'high' },
  ];
  const out = [];
  for (let i = 0; i < need; i++) {
    const a = pick(HK_AREAS), t = pick(types);
    const startedAt = now - rnd(0, 5 * 864e5);
    out.push({
      _id: `disaster-${t.type}-${uuid().slice(0, 8)}`, type: t.type,
      magnitude: chance(0.5) ? Number((Math.random() * 8 + 1).toFixed(1)) : null,
      severity: t.severity, lat: coord(a.lat, a.s), lng: coord(a.lng, a.s),
      radius_km: rnd(3, 25), description: `${t.type} affecting ${a.name} and surrounding areas`,
      started_at: startedAt, ended_at: null, active: true,
    });
  }
  return out;
}

function makeReports(n, users, disasterIds) {
  const reports = [], history = [];
  for (let i = 0; i < n; i++) {
    const u = pick(users);
    const r = Math.random();
    const status = r < 0.55 ? 'safe' : r < 0.72 ? 'injured' : r < 0.88 ? 'need_help' : r < 0.95 ? 'missing' : 'rescued';
    const createdAt = now - rnd(36e5, 7 * 864e5);
    const lat = coord(22.3, 0.18), lng = coord(114.13, 0.28);
    const isProxy = chance(0.22);
    const _id = uuid();
    reports.push({
      _id, name: u.name, name_lower: u.name.toLowerCase(), status, lat, lng,
      phone: u.phone, medical_notes: status === 'injured' ? pick(['minor cut', 'bruising', 'bleeding controlled', null])
        : status === 'need_help' ? pick(['trapped, water rising', 'needs evacuation, elderly', 'structural damage']) : null,
      personal_id: u.personal_id, user_id: u._id, user_type: chance(0.85) ? 'mobile' : 'web',
      disaster_id: chance(0.7) ? pick(disasterIds) : null, reported_by: isProxy ? 'family' : 'self',
      reporter_name: isProxy ? `家人 ${rnd(1000, 9999)}` : null, reported_for_user_id: null,
      relay_count: rnd(0, 4), created_at: createdAt, updated_at: createdAt,
    });
    history.push({ _id: uuid(), report_id: _id, from_status: null, to_status: status, changed_by: 'mobile', changed_at: createdAt, notes: 'Initial report' });
    if (chance(0.3)) {
      const to = pick(['safe', 'injured', 'need_help', 'rescued', 'awaiting_response'].filter((s) => s !== status));
      history.push({ _id: uuid(), report_id: _id, from_status: status, to_status: to, changed_by: pick(['mobile', 'web', 'system']), changed_at: createdAt + rnd(3e5, 2 * 864e5), notes: `Status updated to ${to}` });
    }
  }
  return { reports, history };
}

function makeShelters(n, userIds, disasters) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pick(HK_AREAS), lat = coord(a.lat, a.s), lng = coord(a.lng, a.s);
    const cap = rnd(50, 500), src = pick(['government', 'volunteer', 'citizen']);
    out.push({
      _id: uuid(), created_by_user_id: src === 'citizen' ? pick(userIds) : null,
      name: `${a.name} ${pick(SHELTER_NAMES)}`, type: pick(SHELTER_TYPES), lat, lng,
      disaster_id: disasterForPoint(lat, lng, disasters), address: `${rnd(1, 999)} ${a.name}, Hong Kong`,
      phone: hkPhone(), capacity: cap, current_count: rnd(0, Math.floor(cap * 0.8)), source: src,
      contact_name: src === 'government' ? `官員 ${rnd(1000, 9999)}` : null, hours_open: '24/7',
      active: true, created_at: now - rnd(0, 30 * 864e5), updated_at: now,
    });
  }
  return out;
}

function makeLinks(n, userIds) {
  const out = [], seen = new Set();
  let guard = 0;
  while (out.length < n && guard++ < n * 20) {
    const a = pick(userIds); let b = pick(userIds);
    if (a === b) continue;
    const key = [a, b].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const confirmed = chance(0.6);
    const at = confirmed ? now - rnd(0, 30 * 864e5) : null;
    out.push({ _id: uuid(), user_a_id: a, user_b_id: b, status: confirmed ? 'confirmed' : 'pending', confirmed_at: at, created_at: at || now - rnd(0, 7 * 864e5) });
  }
  return out;
}

function makeDevices(n, users) {
  const out = [], used = new Set();
  for (let i = 0; i < n; i++) {
    let u; do { u = pick(users); } while (used.has(u._id) && used.size < users.length);
    used.add(u._id);
    const plat = pick(['ios', 'android']);
    out.push({ _id: uuid(), user_id: u._id, token: `demo-${plat}-${uuid()}`, platform: plat, lat: coord(22.3, 0.18), lng: coord(114.13, 0.28), created_at: now - rnd(0, 14 * 864e5), updated_at: now });
  }
  return out;
}

function makeRescue(n, reports) {
  // Prefer reports that plausibly need rescuing.
  const pool = reports.filter((r) => ['need_help', 'injured', 'missing'].includes(r.status));
  const src = pool.length ? pool : reports;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = pick(src);
    out.push({ _id: uuid(), report_id: r._id, status: pick(['pending', 'dispatched', 'en_route', 'on_scene', 'resolved']), priority: pick(['low', 'medium', 'high', 'critical']), lat: r.lat, lng: r.lng, notes: pick(['caller unreachable', 'access blocked by flooding', 'multiple casualties reported', null]), requested_at: now - rnd(0, 3 * 864e5), updated_at: now });
  }
  return out;
}

function makeTeams(n, reports) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = pick(reports);
    out.push({ _id: uuid(), report_id: r._id, team_name: `Team ${pick(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])}-${rnd(1, 9)}`, status: pick(['assigned', 'en_route', 'on_scene', 'cleared']), responder_name: `${pick(GIVEN)} ${pick(SURNAMES)}`, assigned_at: now - rnd(0, 2 * 864e5), updated_at: now });
  }
  return out;
}

function makeMissingCases(n, reports, users) {
  const pool = reports.filter((r) => ['missing', 'need_help'].includes(r.status));
  const src = pool.length ? pool : reports;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = pick(src);
    out.push({ _id: uuid(), report_id: r._id, user_id: r.user_id, case_status: pick(['open', 'investigating', 'located', 'closed']), missing_since: now - rnd(36e5, 5 * 864e5), last_seen_lat: r.lat, last_seen_lng: r.lng, reporter_user_id: pick(users)._id, notes: pick(['last contact via phone', 'seen near shelter', 'no contact since onset', null]), created_at: now - rnd(0, 4 * 864e5), updated_at: now });
  }
  return out;
}

function makeSafePlaces(n, userIds, disasterIds) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pick(HK_AREAS);
    const st = pick(['pending', 'approved', 'approved', 'rejected']);
    out.push({ _id: uuid(), created_by_user_id: pick(userIds), name: `${a.name} ${pick(['Refuge', 'Safe Point', 'Rest Area', 'Aid Station'])}`, lat: coord(a.lat, a.s), lng: coord(a.lng, a.s), description: pick(['dry upper floor, open to public', 'verified by local volunteers', 'food and water available']), capacity: rnd(10, 200), disaster_id: chance(0.6) ? pick(disasterIds) : null, active: true, status: st, reviewed_by: st === 'pending' ? null : 'gov-token', reviewed_at: st === 'pending' ? null : now - rnd(0, 2 * 864e5), created_at: now - rnd(0, 10 * 864e5) });
  }
  return out;
}

function makeAuditLogs(n) {
  const actions = [['disaster.trigger', 'disasters'], ['report.escalate', 'reports'], ['safe_place.review', 'safe_places'], ['user.erase', 'users'], ['shelter.create', 'shelters']];
  const out = [];
  for (let i = 0; i < n; i++) {
    const [action, entity] = pick(actions);
    out.push({ _id: uuid(), action, entity, entity_id: uuid(), actor: 'gov-token', details: JSON.stringify({ ip: `203.0.${rnd(0, 255)}.${rnd(1, 254)}` }), created_at: now - rnd(0, 30 * 864e5) });
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  await connect();
  console.log('[fill] connected. wiping generated collections (admin user preserved)...');

  // Wipe everything we regenerate. Keep the super-admin user.
  const wipe = ['reports', 'status_history', 'shelters', 'account_links', 'device_push_tokens', 'rescue_requests', 'team_assignments', 'missing_person_cases', 'safe_places', 'audit_logs'];
  for (const c of wipe) await safeDelete(c);
  await safeDelete('users', { phone: { $ne: ADMIN_PHONE } });

  // Drop the wildcard index during the load. It indexes EVERY field path, so it
  // multiplies the RU cost of every insert — enough that the cold collection
  // throttles (Error=16500) and the mongodb v7 driver recurses to a stack
  // overflow under retryWrites=false. Cheap _id-only writes load cleanly; we
  // rebuild the wildcard indexes (needed for Cosmos sorts) at the end.
  const ALL = ['users', 'disasters', 'reports', 'status_history', 'shelters', 'account_links', 'device_push_tokens', 'rescue_requests', 'team_assignments', 'missing_person_cases', 'safe_places', 'audit_logs'];
  console.log('[fill] dropping wildcard indexes for fast load...');
  for (const c of ALL) {
    try { await collection(c).dropIndex('idx_wildcard'); } catch { /* not present — fine */ }
  }

  // 1) Users
  const users = makeUsers(TARGET.users);
  console.log(`[fill] users → inserting ${users.length} ...`);
  await ensureInserted('users', users);

  // 2) Disasters (top up to target, keep existing)
  const existingDis = await collection('disasters').find({}).project({ _id: 1, lat: 1, lng: 1, radius_km: 1 }).toArray();
  const newDis = makeDisasters(existingDis, TARGET.disasters_total);
  if (newDis.length) { console.log(`[fill] disasters → adding ${newDis.length} (had ${existingDis.length}) ...`); await ensureInserted('disasters', newDis); }
  const disasters = [...existingDis.map((d) => ({ id: d._id, lat: d.lat, lng: d.lng, radius_km: d.radius_km })), ...newDis.map((d) => ({ id: d._id, lat: d.lat, lng: d.lng, radius_km: d.radius_km }))];
  const disasterIds = disasters.map((d) => d.id);
  const userIds = users.map((u) => u._id);

  // 3) Reports + history
  const { reports, history } = makeReports(TARGET.reports, users, disasterIds);
  console.log(`[fill] reports → ${reports.length}, status_history → ${history.length} ...`);
  await ensureInserted('reports', reports);
  await ensureInserted('status_history', history);

  // 4) The rest (all reference real ids)
  const jobs = [
    ['shelters', makeShelters(TARGET.shelters, userIds, disasters)],
    ['account_links', makeLinks(TARGET.account_links, userIds)],
    ['device_push_tokens', makeDevices(TARGET.device_push_tokens, users)],
    ['rescue_requests', makeRescue(TARGET.rescue_requests, reports)],
    ['team_assignments', makeTeams(TARGET.team_assignments, reports)],
    ['missing_person_cases', makeMissingCases(TARGET.missing_person_cases, reports, users)],
    ['safe_places', makeSafePlaces(TARGET.safe_places, userIds, disasterIds)],
    ['audit_logs', makeAuditLogs(TARGET.audit_logs)],
  ];
  for (const [name, docs] of jobs) { console.log(`[fill] ${name} → ${docs.length} ...`); await ensureInserted(name, docs); }

  // 5) Rebuild the wildcard indexes (Cosmos requires them for .sort()).
  console.log('[fill] rebuilding wildcard indexes...');
  for (const c of ALL) {
    await withRetry(() => collection(c).createIndex({ '$**': 1 }, { name: 'idx_wildcard' }), `index ${c}`);
  }

  // 6) Final counts
  console.log('\n[fill] ── final document counts ──');
  for (const c of ALL) console.log(`  ${c.padEnd(22)} ${await collection(c).countDocuments()}`);
  await closeDb();
  console.log('\n[fill] ✓ done');
}

run().catch(async (e) => { console.error('[fill] FATAL:', e.message); try { await closeDb(); } catch {} process.exit(1); });
