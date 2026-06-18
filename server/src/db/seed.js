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
 *   2. ~10,000 randomly generated HK user accounts
 *
 * No seeded reports. No seeded shelters. Override the user volume with
 * SEED_USER_COUNT.
 */

const USER_COUNT = Number(process.env.SEED_USER_COUNT) || 10000;
const BATCH_SIZE = 1000;

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
    _id: u.id, phone: u.phone, name: u.name, email: u.email,
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

    return summary;
  } catch (err) {
    console.error('[db/seed] seeding failed:', err);
    throw err;
  }
}

module.exports = { seed, DISASTERS, USER_COUNT };
