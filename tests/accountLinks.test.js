import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// P1 — the family loved-one LINK LIFECYCLE (request → confirm → remove) and the
// CONSENT GATE it enforces. lovedOneCascade.test.js seeds account_links
// directly; this suite drives the real HTTP endpoints in routes/users.js so the
// request/confirm/remove flow — and the rule that a partner's report status
// stays hidden until BOTH sides consent — is actually covered.
//
// Users are seeded directly (with token hashes) rather than via POST /register,
// matching safePlaces.test.js / incidentRoutes.test.js — this keeps the suite
// off the registration rate-limiter and independent of the register path.
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const { hashToken } = require('../server/src/lib/authGuard');
const createUsersRouter = require('../server/src/routes/users');

let server, base;

// Three citizens. `local` is the bare 8-digit phone a client would type; the
// LinkRequestSchema normalises it to the stored +852 form.
const ALICE = { id: 'alice', tok: 'alice-tok', phone: '+85290000001', local: '90000001' };
const BOB   = { id: 'bob',   tok: 'bob-tok',   phone: '+85290000002', local: '90000002' };
const CAROL = { id: 'carol', tok: 'carol-tok', phone: '+85290000003', local: '90000003' };

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/users', createUsersRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

async function addUser(u) {
  const now = Date.now();
  await collection('users').insertOne({
    _id: u.id, phone: u.phone, name: u.id, role: 'citizen', privacy_consent: true,
    access_token_hash: hashToken(u.tok), access_token_expires_at: now + 3600_000,
    created_at: now, updated_at: now,
  });
}

async function seedReport(userId, status) {
  const now = Date.now();
  await collection('reports').insertOne({
    _id: `rep-${userId}`, name: 'seed', name_lower: 'seed', status,
    lat: 22.30, lng: 114.17, user_id: userId, user_type: 'mobile',
    created_at: now, updated_at: now,
  });
}

const call = (path, tok, opts = {}) => fetch(`${base}${path}`, {
  ...opts,
  headers: {
    'Content-Type': 'application/json',
    ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    ...(opts.headers || {}),
  },
});

// Alice requests a link to Bob; returns the created link id.
async function aliceRequestsBob() {
  const res = await call(`/api/users/${ALICE.id}/links`, ALICE.tok, {
    method: 'POST', body: JSON.stringify({ target_phone: BOB.local }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data.id;
}

beforeEach(async () => {
  await collection('account_links').deleteMany({});
  await collection('reports').deleteMany({});
  await collection('users').deleteMany({});
  await addUser(ALICE);
  await addUser(BOB);
  await addUser(CAROL);
});

describe('request a link', () => {
  it('requires authentication (401)', async () => {
    const res = await call(`/api/users/${ALICE.id}/links`, null, {
      method: 'POST', body: JSON.stringify({ target_phone: BOB.local }),
    });
    expect(res.status).toBe(401);
  });

  it("cannot act on another user's links (403 own-guard)", async () => {
    // Carol's token, Alice's :id → forbidden.
    const res = await call(`/api/users/${ALICE.id}/links`, CAROL.tok, {
      method: 'POST', body: JSON.stringify({ target_phone: BOB.local }),
    });
    expect(res.status).toBe(403);
  });

  it('creates a PENDING link to an existing user', async () => {
    const res = await call(`/api/users/${ALICE.id}/links`, ALICE.tok, {
      method: 'POST', body: JSON.stringify({ target_phone: BOB.local }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe('pending');
    expect(data.id).toBeTruthy();
  });

  it('rejects linking to yourself (400)', async () => {
    const res = await call(`/api/users/${ALICE.id}/links`, ALICE.tok, {
      method: 'POST', body: JSON.stringify({ target_phone: ALICE.local }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown target phone (404)', async () => {
    const res = await call(`/api/users/${ALICE.id}/links`, ALICE.tok, {
      method: 'POST', body: JSON.stringify({ target_phone: '96543210' }),
    });
    expect(res.status).toBe(404);
  });

  it('is idempotent — re-requesting the same target does not duplicate', async () => {
    await aliceRequestsBob();
    await aliceRequestsBob();
    expect(await collection('account_links').countDocuments({ user_a_id: ALICE.id, user_b_id: BOB.id })).toBe(1);
  });
});

describe('confirm a link — only the recipient may accept', () => {
  it('recipient (user_b) confirms → status becomes confirmed', async () => {
    const linkId = await aliceRequestsBob();
    const res = await call(`/api/users/${BOB.id}/links/${linkId}`, BOB.tok, { method: 'PUT' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe('confirmed');
    const al = await collection('account_links').findOne({ _id: linkId });
    expect(al.status).toBe('confirmed');
    expect(al.confirmed_at).toBeTruthy();
  });

  it('the REQUESTER cannot confirm their own outgoing link (404)', async () => {
    const linkId = await aliceRequestsBob();
    // Alice is user_a — confirmLink only matches user_b, so nothing is found.
    const res = await call(`/api/users/${ALICE.id}/links/${linkId}`, ALICE.tok, { method: 'PUT' });
    expect(res.status).toBe(404);
  });
});

describe("roster — a partner's status is withheld until BOTH sides consent", () => {
  it('hides report_status while pending, reveals it once confirmed', async () => {
    await seedReport(BOB.id, 'need_help'); // Bob has an active report
    const linkId = await aliceRequestsBob();

    // PENDING: Alice sees Bob in her roster, but his status is withheld.
    let roster = (await (await call(`/api/users/${ALICE.id}/links`, ALICE.tok)).json()).data;
    expect(roster).toHaveLength(1);
    expect(roster[0].link_status).toBe('pending');
    expect(roster[0].is_incoming).toBe(false);  // Alice requested it
    expect(roster[0].report_status).toBeNull();  // consent gate — no status yet

    // Bob sees the SAME link as incoming.
    const bobRoster = (await (await call(`/api/users/${BOB.id}/links`, BOB.tok)).json()).data;
    expect(bobRoster[0].is_incoming).toBe(true);

    await call(`/api/users/${BOB.id}/links/${linkId}`, BOB.tok, { method: 'PUT' });

    // CONFIRMED: Bob's status is now visible to Alice.
    roster = (await (await call(`/api/users/${ALICE.id}/links`, ALICE.tok)).json()).data;
    expect(roster[0].link_status).toBe('confirmed');
    expect(roster[0].report_status).toBe('need_help');
  });
});

describe('remove a link — either side, idempotent', () => {
  it('removes the link from both rosters and is a no-op on repeat', async () => {
    const linkId = await aliceRequestsBob();
    await call(`/api/users/${BOB.id}/links/${linkId}`, BOB.tok, { method: 'PUT' });

    const res = await call(`/api/users/${ALICE.id}/links/${linkId}`, ALICE.tok, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await collection('account_links').findOne({ _id: linkId })).toBeNull();

    // Gone from both rosters.
    expect((await (await call(`/api/users/${ALICE.id}/links`, ALICE.tok)).json()).data).toHaveLength(0);
    expect((await (await call(`/api/users/${BOB.id}/links`, BOB.tok)).json()).data).toHaveLength(0);

    // Removing again still succeeds (idempotent).
    const again = await call(`/api/users/${ALICE.id}/links/${linkId}`, ALICE.tok, { method: 'DELETE' });
    expect(again.status).toBe(200);
  });
});

// Kept LAST: this exhausts the per-IP link limiter for the run.
describe('K6 — link-request rate limit', () => {
  it('429s once the hourly cap (50/hour) is exceeded', async () => {
    let saw429 = false;
    for (let i = 0; i < 60; i++) {
      // target a non-existent phone (→404) — the limiter still counts every
      // request that passes auth, so the cap trips regardless of the outcome.
      const res = await call(`/api/users/${ALICE.id}/links`, ALICE.tok, {
        method: 'POST', body: JSON.stringify({ target_phone: '96000000' }),
      });
      if (res.status === 429) { saw429 = true; break; }
    }
    expect(saw429).toBe(true);
  });
});
