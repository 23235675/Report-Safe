'use strict';

const crypto = require('crypto');
const { collection } = require('./mongo');

/** True if a thrown error is purely duplicate-key (the former ON CONFLICT … DO NOTHING). */
function isOnlyDupKey(err) {
  if (!err) return false;
  if (err.code === 11000) return true;
  if (Array.isArray(err.writeErrors) && err.writeErrors.length) {
    return err.writeErrors.every((e) => (e.err?.code ?? e.code) === 11000);
  }
  return false;
}

/*
 * Hong Kong seed data — the ONLY data this project ships with.
 *
 * Seeds exactly two things (everything else comes from real usage so the
 * app relies fully on the database):
 *   1. Active HK disasters (HKO-style incidents)
 *   2. A small set of randomly generated HK user accounts (default 100)
 *
 * No seeded reports. No seeded shelters. (M8) The default is 100 — not 10,000 —
 * so first boot can't exhaust the Cosmos Free Tier RU budget; override with
 * SEED_USER_COUNT. Seeding is gated by SEED_DATA: off by default in production
 * (set SEED_DATA=true to opt in), on by default in dev/test.
 */

const USER_COUNT = Number(process.env.SEED_USER_COUNT) || 100;
const BATCH_SIZE = 1000;

/** Whether to seed at all (M8). Production opts IN; everywhere else opts OUT only via SEED_DATA=false. */
function seedingEnabled() {
  if (process.env.SEED_DATA === 'false') return false;
  if (process.env.NODE_ENV === 'production') return process.env.SEED_DATA === 'true';
  return true;
}

// ── Active disasters: Hong Kong incidents ───────────────────────────
const DISASTERS = [
  {
    id: 'disaster-typhoon-hk',
    type: 'typhoon',
    magnitude: null,
    severity: 5,
    lat: 22.302,
    lng: 114.177,
    radius_km: 60,
    description: 'Super Typhoon — HKO Hurricane Signal No. 10 (T10) in force across Hong Kong.',
  },
  {
    id: 'disaster-rainstorm-kln',
    type: 'flood',
    magnitude: null,
    severity: 3,
    lat: 22.336,
    lng: 114.193,
    radius_km: 15,
    description: 'Black Rainstorm Warning — severe flooding across Kowloon East.',
  },
  {
    id: 'disaster-landslip-midlevels',
    type: 'landslide',
    magnitude: null,
    severity: 3,
    lat: 22.271,
    lng: 114.150,
    radius_km: 6,
    description: 'Landslip Warning — slope failure reported near Po Shan Road, Mid-Levels.',
  },
];

// ── CFR: public AED registry (Hong Kong) ─────────────────────────────
// Seeded near the seeded disaster/incident centroids so the responder map has
// something to show. A real NEAR/government registry import replaces this later
// (same shape, source:'gov_registry').
const AEDS = [
  { name: 'MTR Central Station — Concourse', lat: 22.3019, lng: 114.1681, address: 'Central Station', floor: 'Concourse', available_hours: 'Train service hours' },
  { name: 'IFC Mall — Level 1 Concierge',    lat: 22.2851, lng: 114.1588, address: '8 Finance St, Central', floor: 'L1', available_hours: '10:00–22:00' },
  { name: 'Statue Square — Public Pavilion', lat: 22.2809, lng: 114.1602, address: 'Statue Square, Central', floor: 'G', available_hours: '24h' },
  { name: 'Admiralty Centre — Lobby',        lat: 22.2790, lng: 114.1647, address: '18 Harcourt Rd', floor: 'G', available_hours: '07:00–23:00' },
  { name: 'Sheung Wan MTR — Exit A',         lat: 22.2866, lng: 114.1520, address: 'Sheung Wan Station', floor: 'Concourse', available_hours: 'Train service hours' },
  { name: 'Hong Kong City Hall — Foyer',     lat: 22.2820, lng: 114.1640, address: '5 Edinburgh Pl', floor: 'G', available_hours: '09:00–21:00' },
  { name: 'Kowloon — MegaBox L1 Info Desk',  lat: 22.3214, lng: 114.2099, address: '38 Wang Chiu Rd, Kowloon Bay', floor: 'L1', available_hours: '11:00–22:00' },
  { name: 'Kowloon Bay MTR — Concourse',     lat: 22.3236, lng: 114.2143, address: 'Kowloon Bay Station', floor: 'Concourse', available_hours: 'Train service hours' },
  { name: 'Telford Plaza — Atrium',          lat: 22.3231, lng: 114.2127, address: '33 Wai Yip St', floor: 'L1', available_hours: '10:00–22:00' },
  { name: 'Mid-Levels — Central Escalator',  lat: 22.2820, lng: 114.1545, address: 'Central–Mid-Levels Escalator', floor: 'Street', available_hours: '06:00–24:00' },
];

// ── CFR: a small set of opt-in responders with fixed test phones ─────
// Each gets a device_push_token at a known location so the matcher can find
// them. Platform 'expo' → remote push is skipped (no native handle in dev), but
// the socket alert + the matching logic exercise fully. 'government' role
// responders also receive residential (non-public) incidents.
const RESPONDERS = [
  { phone: '+85251110001', name: 'CFR Alice Chan',  role: 'citizen',    skills: ['cpr', 'aed'], radius: 1.5, lat: 22.3025, lng: 114.1775 }, // ~by Central incident
  { phone: '+85251110002', name: 'CFR Bobby Wong',  role: 'citizen',    skills: ['cpr', 'aed'], radius: 0.8, lat: 22.3010, lng: 114.1760 },
  { phone: '+85251110003', name: 'CFR Carol Lam',   role: 'citizen',    skills: ['cpr', 'fire'], radius: 1.5, lat: 22.3355, lng: 114.1920 }, // ~by Kowloon fire
  { phone: '+85251110004', name: 'CFR Dr. Dorothy', role: 'government', skills: ['cpr', 'aed'], radius: 2.0, lat: 22.3030, lng: 114.1780 }, // verified — gets residential
];

// ── Random HK user generation ────────────────────────────────────────
const SURNAMES_ROMAN = [
  'Chan', 'Wong', 'Lee', 'Cheung', 'Lam', 'Ng', 'Leung', 'Ho', 'Lau', 'Tsang',
  'Chow', 'Yip', 'Mak', 'Tang', 'Fung', 'Siu', 'Kwok', 'Yeung', 'Tam', 'Choi',
  'Lui', 'Yuen', 'Kwan', 'Mok', 'To', 'Hui', 'Shum', 'Pang', 'Au', 'Tse',
];
const GIVEN_ROMAN = [
  'Tai Man', 'Ka Yan', 'Wing Sze', 'Chun Kit', 'Hoi Ying', 'Wai Ling', 'Siu Ming',
  'Ka Ho', 'Cheuk Hei', 'Tsz Ying', 'Man Wai', 'Yuk Ling', 'Chi Keung', 'Mei Ling',
  'Ho Yin', 'Sze Wan', 'Kin Wah', 'Lai Fan', 'Tsz Chun', 'Wing Yan', 'Chun Ho',
  'Hiu Tung', 'Ka Ming', 'Yee Man', 'Pak Hei', 'Sum Yi', 'Long Hin', 'Cheuk Lam',
];
const SURNAMES_CN = ['陳', '黃', '李', '張', '林', '吳', '梁', '何', '劉', '曾', '周', '葉', '鄧', '馮', '郭', '楊'];
const GIVEN_CN    = ['大文', '嘉欣', '詠詩', '俊傑', '凱瑩', '慧玲', '兆明', '家豪', '卓希', '子瑩', '文偉', '玉玲', '志強', '美玲', '浩然', '思敏'];

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com.hk', 'hotmail.com', 'outlook.com', 'netvigator.com'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Synthetic-but-checksum-valid HKID (random letter + 6 digits + check digit). */
function fakeHKID() {
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10));
  let sum = 36 * 9 + (letter.charCodeAt(0) - 55) * 8;
  digits.forEach((d, i) => { sum += d * (7 - i); });
  const check = (11 - (sum % 11)) % 11;
  return `${letter}${digits.join('')}${check === 10 ? 'A' : check}`;
}

/** HK mobile number: 8 digits, leading 5 / 6 / 9. */
function fakeHKPhone() {
  const lead = pick(['5', '6', '9']);
  let rest = '';
  for (let i = 0; i < 7; i++) rest += Math.floor(Math.random() * 10);
  return `+852${lead}${rest}`;
}

function buildUser(now, usedPhones, usedIds) {
  // Unique phone + HKID (retry on collision; space is large so retries are rare)
  let phone;
  do { phone = fakeHKPhone(); } while (usedPhones.has(phone));
  usedPhones.add(phone);

  let personalId;
  do { personalId = fakeHKID(); } while (usedIds.has(personalId));
  usedIds.add(personalId);

  const useChinese = Math.random() < 0.4;
  const name = useChinese
    ? `${pick(SURNAMES_CN)}${pick(GIVEN_CN)}`
    : `${pick(GIVEN_ROMAN)} ${pick(SURNAMES_ROMAN)}`;

  const email = Math.random() < 0.4
    ? `${name.replace(/[^a-zA-Z]/g, '').toLowerCase() || 'user'}${Math.floor(Math.random() * 9999)}@${pick(EMAIL_DOMAINS)}`
    : null;

  const roleRand  = Math.random();
  const role      = roleRand < 0.97 ? 'citizen' : roleRand < 0.995 ? 'volunteer' : 'government';
  const userType  = Math.random() < 0.85 ? 'mobile' : 'web';
  const createdAt = now - Math.floor(Math.random() * 90 * 24 * 60 * 60 * 1000); // last 90 days

  return {
    id: crypto.randomUUID(),
    phone,
    name,
    gender: Math.random() < 0.5 ? 'male' : 'female',
    email,
    personal_id: personalId,
    user_type: userType,
    role,
    privacy_consent: Math.random() < 0.7,
    created_at: createdAt,
  };
}

/** Batched bulk insert — ~10k rows in a handful of unordered insertMany calls. */
async function insertUserBatch(users) {
  const docs = users.map((u) => ({
    _id: u.id, phone: u.phone, name: u.name, gender: u.gender, email: u.email,
    personal_id: u.personal_id, user_type: u.user_type, role: u.role,
    privacy_consent: u.privacy_consent, created_at: u.created_at, updated_at: u.created_at,
  }));
  try {
    // ordered:false → keep inserting past any individual duplicate (the former
    // ON CONFLICT (phone) DO NOTHING). Re-throw anything that isn't a dup key.
    await collection('users').insertMany(docs, { ordered: false });
  } catch (err) {
    if (!isOnlyDupKey(err)) throw err;
  }
}

async function seed() {
  try {
    const summary = { seeded: false, disasters: 0, users: 0 };
    if (!seedingEnabled()) {
      console.log('[db/seed] skipped (SEED_DATA gate) — set SEED_DATA=true to seed demo data');
      return { ...summary, skipped: true };
    }

    // Disasters — only if none exist yet.
    const dCount = await collection('disasters').countDocuments({});
    if (dCount === 0) {
      const startedAt = Date.now() - 1000 * 60 * 60;
      const docs = DISASTERS.map((d) => ({
        _id: d.id, type: d.type, magnitude: d.magnitude ?? null, severity: d.severity ?? null,
        lat: d.lat, lng: d.lng, radius_km: d.radius_km, description: d.description ?? null,
        started_at: startedAt, ended_at: null, active: true,
      }));
      try {
        await collection('disasters').insertMany(docs, { ordered: false });
      } catch (err) {
        if (!isOnlyDupKey(err)) throw err; // ON CONFLICT (id) DO NOTHING
      }
      summary.disasters = DISASTERS.length;
      summary.seeded = true;
    }

    // Users — only if none exist yet.
    const uCount = await collection('users').countDocuments({});
    if (uCount === 0) {
      const now = Date.now();
      const usedPhones = new Set();
      const usedIds = new Set();

      for (let done = 0; done < USER_COUNT; done += BATCH_SIZE) {
        const n = Math.min(BATCH_SIZE, USER_COUNT - done);
        const batch = Array.from({ length: n }, () => buildUser(now, usedPhones, usedIds));
        await insertUserBatch(batch);
      }
      summary.users = USER_COUNT;
      summary.seeded = true;
      console.log(`[db/seed] generated ${USER_COUNT} HK user accounts`);
    }

    // CFR AEDs — only if none exist yet.
    const aedCount = await collection('aed_locations').countDocuments({});
    if (aedCount === 0) {
      const now = Date.now();
      const docs = AEDS.map((a) => ({
        _id: crypto.randomUUID(), name: a.name, lat: a.lat, lng: a.lng,
        address: a.address ?? null, floor: a.floor ?? null,
        available_hours: a.available_hours ?? null, source: 'seed', active: true, created_at: now,
      }));
      try {
        await collection('aed_locations').insertMany(docs, { ordered: false });
      } catch (err) {
        if (!isOnlyDupKey(err)) throw err;
      }
      summary.aeds = AEDS.length;
      summary.seeded = true;
      console.log(`[db/seed] seeded ${AEDS.length} AED locations`);
    }

    // CFR opt-in responders — only if none opted in yet. Each gets a device
    // location so the incident matcher can find them.
    const responderCount = await collection('users').countDocuments({ responder_opt_in: true });
    if (responderCount === 0) {
      const now = Date.now();
      for (const r of RESPONDERS) {
        const userId = crypto.randomUUID();
        // Upsert the user by phone (idempotent across boots).
        await collection('users').updateOne(
          { phone: r.phone },
          {
            $setOnInsert: { _id: userId, phone: r.phone, user_type: 'mobile', created_at: now },
            $set: {
              name: r.name, role: r.role, privacy_consent: true,
              personal_id: fakeHKID(),
              responder_opt_in: true, responder_skills: r.skills, responder_max_radius_km: r.radius,
              updated_at: now,
            },
          },
          { upsert: true }
        );
        const saved = await collection('users').findOne({ phone: r.phone }, { projection: { _id: 1 } });
        // Device location row (the matcher reads location from here).
        await collection('device_push_tokens').updateOne(
          { token: `seed-cfr-${r.phone}` },
          { $set: { platform: 'expo', lat: r.lat, lng: r.lng, user_id: saved._id, updated_at: now }, $setOnInsert: { _id: crypto.randomUUID(), created_at: now } },
          { upsert: true }
        );
      }
      summary.responders = RESPONDERS.length;
      summary.seeded = true;
      console.log(`[db/seed] seeded ${RESPONDERS.length} opt-in CFR responders`);
    }

    return summary;
  } catch (err) {
    console.error('[db/seed] seeding failed:', err);
    throw err;
  }
}

module.exports = { seed, DISASTERS, USER_COUNT, AEDS, RESPONDERS };
