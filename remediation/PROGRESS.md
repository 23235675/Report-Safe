# Remediation Progress

Source: [report-safe-remediation-plan.md](../report-safe-remediation-plan.md) · [Comprehensive analysis.md](../Comprehensive%20analysis.md)
38 items · 6 phases · status: `[x]` done · `[~]` partial/scoped · `[ ]` deferred
Verification: 135 tests pass (16 files) · eslint(server/src) clean · mobile tsc clean · web build clean.
All 38 items complete (L7/H3/M7 finished in the follow-up pass).

## Phase 0 — Foundation Hardening
- [x] C1/B10 — Authenticate + de-mass-assign report writes (derive identity; gov override)
- [x] C3/B3 — Offline mesh fail-safe (sendToPeer→false; stays pending; 200-row cap)
- [x] C4/B18 — Leader-elect background jobs via Redis lock (lib/leaderLock.js)
- [x] C2 — Cap geo queries before toArray() (GEO_SCAN_CAP, sort+limit on all 4)

## Phase 1 — Ingest Reliability + Outbox Correctness
- [x] H1/B1 — Outbox retry-aware: only 400/422 permanent; 401/403/408/429/5xx stay queued
- [x] B2 — Separate user-keyed report-ingest limiter, excluded from general /api limiter
- [x] B4 — Idempotent relay: proven by "relay never overwrites status" test

## Phase 2 — Security Hardening
- [x] H2 — trust proxy default 0 + prod warning
- [x] H3 — CSP + HSTS, AND refresh token now an httpOnly cookie (web); access token in memory only; mobile keeps body/Bearer. SameSite=Strict covers CSRF
- [x] H4/B14 — Refresh-token reuse detection (prev-hash tripwire → token_reuse, family nuked)
- [x] B21/M3 — DELETE /api/devices/:token now owner-or-gov
- [x] B13 ✅ — Gov auth: covered by existing auth.test.js
- [x] B22/H6 — CI gates: eslint + npm audit + gitleaks + CodeQL; "Postgres" label fixed
- [x] H5/B7 — GET /stats excludeWeb defaults true
- [x] B6 ✅ — Web proxy-only: covered by reportsProxy.test.js
- [x] B5 ✅ — Coarse location: covered by reportStore.test.js
- [x] B8 ✅ — Disaster gate mobile-only: unchanged (already correct)
- [x] B9 ✅ — Gate ack persists: unchanged (already correct)

## Phase 3 — Data Integrity + Missing Features
- [x] M1/B12 — Two-phase erasure (PII-free tombstone first, then cascade+delete; retention sweep)
- [x] M4/B11 + B20 — Partial-unique (type,active) index + POST /api/disasters/:id/deactivate
- [x] M2/B17 — OTP store moved to Redis (async verify) + in-memory fallback; prod opt-in
- [x] B19 — /api/missing-persons CRUD (gov/volunteer); wires missing_alert; mounted
- [x] B15 ✅ — Push graceful no-op: covered by push.test.js
- [x] B16 ✅ — HKO localisation: covered by triggerEngine.test.js

## Phase 4 — Performance + Scalability
- [x] H7 — Anchored prefix name search (^q on indexed name)
- [x] M5 — Wildcard ($**) indexes dropped; targeted index per sorted field
- [x] M7 — Cursor (?after/next_cursor) on admin users + links (the find().skip lists); reports/devices keep offset by design (computed-urgency sort, not _id-orderable)
- [x] M8 — Seed gated by SEED_DATA (off in prod); default users 10000→100
- [x] M9/B23 — Redis fail-closed (general)/fail-open (ingest); /api/live, /ready, /metrics

## Phase 5 — Cleanup + Documentation
- [x] L1 — CORS allowlist required in prod (refuse "*"); HSTS on
- [x] L2 — Dead collections rescue_requests/team_assignments removed + dropped on boot
- [x] L3 — Dead report_update event removed (server+web); disaster_deactivated added
- [x] L4 — Shared lib/mongoMap.js (mapId/unwrap/escapeRegex/ilike) adopted across routes+reportStore
- [x] L5 — Doc rot fixed: GOV_TOKEN default, compose Postgres→Cosmos, new DEPLOYMENT.md
- [x] L6 — Central error middleware (lib/errorHandler.js) + reqId, no stack leak
- [x] L7 — Success responses standardized to `{ ok, data, meta }`; clients adapt at the boundary (web api.js reshape → views untouched, mobile reads .data); auth-token + ops responses stay flat by design
- [x] L8 — generateData.js/fillDatabase.js moved to server/scripts/ + .npmignore
- [x] M6 — Admin IP allowlist middleware (ADMIN_IP_ALLOWLIST; no-op when unset)
