# Report Safe (報平安) — Complete Codebase Review

> **Document:** `fable5.md` · produced 2026-07-02, revised 2026-07-06 under strict execution constraints (zero truncation in Phases 1 & 4, complete production-ready refactored files, minimalist naming, explicit persistence-leak inventory).
> **Scope:** full repository — `server/` (Express 4 + Socket.IO 4 + MongoDB 7), `web/` (Vue 3 + Vite + Leaflet), `mobile/` (React Native 0.85 + Expo SDK 56 + TS strict), `tests/`, root tooling, infra and docs.
> **Baseline:** branch `test` @ `6f4b8c5`, with uncommitted edits to `CLAUDE.md`, `README.md`, `AdminView.vue`, `GovView.vue`.
> **Method:** first-hand reads of the server backbone (entry, auth, validation, realtime, data store, trigger engine, error/logging kernel) plus four parallel exploration sweeps (server routes/engines, web, mobile, dependencies/config), cross-checked against each other. Every claim carries a `file:line` reference verified against the working tree.
>
> **Application status (2026-07-06, second pass):** roadmap Steps 4–7 are now ALSO APPLIED — auth consolidated onto `resolvePrincipal`/`requireRole`, realtime hub (`emitGlobal`/`emitToUsers`/`emitInRadius`), `geo.findWithinRadius` absorbing every radius loop, stores for all seven orphan domains + admin Zod conversion, the full console→logger sweep (0 remaining; eslint `no-console` at error), client decomposition (GovView 904→607 + 4 panels + `lib/radar.js`; AdminView on TAB_CONFIG + DataTable + LoginPanel; `useLiveQuery`; api.js on one `request()` core; DisasterModeContext 400→122 + 3 providers; AccountScreen 667→278 + 4 panels; mesh Layer 2 gated behind `MESH_ENABLED`, default off), and `shared/` vocabulary (statuses/hkid/phone) with a CI drift check. Deviations: the optional `domains/` folder move and the physical zodSchemas split were skipped; `routes/admin` keeps its queries pending its own store pass (exempt from the new no-db-in-routes lint rule); shared i18n keys deferred (drift check covers hkid/phone/statuses). Full gate green: 21 test files passed / 1 skipped (Redis self-skip, 164 tests), lint 0/0, web build, mobile tsc + 8/8 units, plus a full-stack preview smoke (server on `mongodb-memory-server`, gov console authenticated end-to-end). `npm run test:memdb` is now a permanent no-Docker test path. Bonus: the api.js rewrite fixed a pre-existing wire bug — custom headers were discarding `Content-Type: application/json`, silently breaking every authenticated web POST.
>
> **Application status (2026-07-06, first pass):** roadmap Steps 0–3 are APPLIED to the working tree — all §4.2/§4.3 files landed verbatim, plus the Step-1 removals (two corrections found during application: `expo-font` was KEPT because it is wired as an `app.json` config plugin backing `@expo/vector-icons`, and `getCurrentUser`/`currentUserRole` were de-exported rather than deleted because `canManageFacilities()` uses them internally). Verified: ESLint 0 errors, web build, mobile `tsc --noEmit`, mobile unit tests 8/8, module smoke + policy behavioral tests. The DB-backed suite (20 files / 159 tests) could not run on the authoring machine (no Docker/MongoDB) — run `npm run db:up && npm test` before deploying. Steps 4–7 remain future work.
>
> **Size of the system:** ~20,000 lines of product code — server 6,925 (39 files), web 6,429, mobile 6,639 — plus 2,420 lines of tests (18 suites in `tests/`, 2 mobile pure-logic suites, 2 web pure-logic suites). 66 HTTP endpoints (42 feature + 20 admin + 4 health), 9 Socket.IO events, 4 background engines.

---

## Executive Summary

Report Safe is in **substantially better shape than a typical project of this size**. It has already been through a remediation pass and it shows: validation is centralized in Zod schemas, secrets never leave the server (`publicUser`/`fromDoc` destructure-to-omit), rate limiting fails closed, refresh tokens rotate with reuse detection, the offline outbox on mobile genuinely guarantees the core invariant ("a citizen's report is never lost"), and graceful degradation (no Redis, no push hub, no OTP) is consistent. **None of the findings below are architectural emergencies.**

The entropy that *does* exist is concentrated and specific:

1. **The route layer is where the mess lives.** Virtually every one of the ~60 handlers hand-rolls the same 4-line Zod `safeParse` block, the same `try/catch → console.error → 500` tail, and (in 15 of 17 route/service files) raw `collection()` access. There are **117 `console.*` calls across 27 server files** against the project's own documented rule ("use `lib/logger`, not `console.*`") — only 37 `logger.*` calls in 9 files follow it. The consequence is real: those 117 sites lose the request-ID correlation and JSON structure that `lib/logger.js:47-66` provides.
2. **One store, six orphan domains.** `reportStore.js` is the only data-access layer; shelters, safe places, incidents, missing persons, devices and AED all do Mongo I/O inline in their route files, and the box-filter+haversine+sort geo pattern is copy-pasted across five files (explicit inventory in §2.3).
3. **Four near-identical auth middlewares** (`authGuard`, `authenticate`, `allowGovOrVolunteer`, `requireSuperAdmin` — authGuard.js:108-254) and **four near-identical socket broadcast loops** (realtimeService.js:108-210) that differ only in a filter predicate.
4. **Three god-files on the client side:** `GovView.vue` (904 lines, ~350-line `<script setup>` mixing auth, fetching, socket wiring, triage math and SVG radar-chart geometry), `AccountScreen.tsx` (667 lines), and `DisasterModeContext.tsx` (400 lines with one 107-line mega-`useEffect` owning 8 socket handlers).
5. **~10 dead or misplaced dependencies** (headline: the entire `firebase` package on mobile is unreachable code) and a handful of orphaned scripts/docs, including a deployment doc that names the wrong Node major version.
6. **Comment archaeology:** ~50 remediation ticket codes (`M1`, `H3`, `B2`, `C2` and similar) across 24 server files, SQL-era narration ("mirrors the SQL JOIN", "the former Postgres 23505") in a Mongo codebase, and a private marker word (`ponytail:`) in 8 files — self-documenting history that raises the barrier of entry for anyone who wasn't present for the migration.

The target architecture (Phase 3) is **not a rewrite**. It is the same pragmatic monolith with three mechanical corrections — an HTTP kernel (validate/asyncHandler/HttpError), a store per domain, and one implementation per concept — plus a client-side decomposition of the three god-files. The roadmap (Phase 4) sequences it so `npm test` (20 files / 159 tests) stays green after every step.

---

# PHASE 1 — Feature Mapping & Behavioral Review

## 1.1 What the system actually is

One Node process serves everything: REST API + Socket.IO + the compiled Vue SPA (index.js:149-171). Three client surfaces with deliberately different trust levels:

| Surface | Trust tier | Can do | Cannot do (enforced, not just absent) |
|---|---|---|---|
| **Mobile app** (React Native) | Citizen, authenticated | Self-report status w/ GPS, offline outbox, receive disaster/loved-one/incident alerts, CFR responder duty, family links, shelter browsing + safe-place suggestions | — |
| **Web SPA** (Vue) | Family proxy + gov/admin consoles | Proxy-report *about someone else*, search roster, manage links, gov triage map, admin CRUD | Self-report, report "safe" (reports.js:110-115), supply browser GPS (reports.js:118-129), be counted in official stats (reportStore.js:409-416), receive alerts (realtimeService.js:117) |
| **Gov static token / super-admin** | Privileged | Full triage incl. PII+GPS, trigger/deactivate disasters, dispatch/resolve incidents, missing-person cases, full CRUD + audit | — |

**Bootstrap order** (index.js:40-216): Redis (optional) → Mongo setup (collections + indexes, no per-collection throughput — the Cosmos free-tier guardrail) → seed-if-empty + super-admin provision → Express middleware chain (`securityHeaders → cors → requestLogger → json(2mb) → /api limiter with ingest + health exemptions`) → HTTP + Socket.IO (Redis adapter when available) → health split (`/live`, `/ready`, `/metrics`, legacy `/health`) → 10 routers → static SPA + catch-all → central `errorHandler` last → 4 engines → graceful shutdown (timers → HTTP drain → Mongo → Redis).

## 1.2 System feature matrix

### A. Citizen identity & auth (`routes/users.js`, `lib/authGuard.js`)

| Capability | Endpoint | Auth | Validation | Notes |
|---|---|---|---|---|
| OTP request | `POST /api/users/request-otp` | — (5/15 min limiter) | `LoginSchema` | Meaningful only when `OTP_ENABLED=true`; echoes `dev_code` in dev |
| Register (upsert by phone) | `POST /api/users/register` | — (10/hr limiter) | `UserRegisterSchema` | Requires `phone, name, gender, personal_id (HKID), privacy_consent===true`; returns one-time access+refresh pair; refresh also set as httpOnly cookie for web (users.js:23-31) |
| Login (phone-only) | `POST /api/users/login` | — (shares register limiter) | `LoginSchema` | No citizen passwords; OTP gate when enabled |
| Token refresh (rotating) | `POST /api/users/token/refresh` | — (30/15 min limiter) | inline | One-time-use refresh; presenting the *previous* hash nukes the whole token family (users.js:236-250) |
| Profile read | `GET /api/users/:phone/profile` | `authenticate`, owner-or-gov | — | HKID always masked (`A•••••(7)`) |
| Profile update | `PATCH /api/users/:id` | `authenticate`, owner-or-gov | `UserUpdateSchema` | COALESCE semantics — absent fields unchanged |
| Erasure (PDPO DPP6) | `DELETE /api/users/:id` | `authenticate`, owner-or-gov | — | Two-phase erasure cascade (§1.5 Trace D) |
| CFR opt-in | `PATCH /api/users/:id/responder` | `authenticate`, owner-or-gov | `ResponderProfileSchema` | Skills ⊆ {cpr, aed, fire}, radius ≤ 5 km; opting out clears skills |

### B. Family links (`routes/users.js:378-552`)

| Capability | Endpoint | Auth | Notes |
|---|---|---|---|
| Request link by phone | `POST /api/users/:id/links` | owner-or-gov (50/hr) | Upsert on (user_a, user_b); pending until accepted |
| Confirm pending link | `PUT /api/users/:id/links/:link_id` | owner-or-gov | Only user_b (the recipient) can confirm |
| Remove link | `DELETE /api/users/:id/links/:link_id` | owner-or-gov | Either side may remove |
| Roster w/ live status | `GET /api/users/:id/links` | owner-or-gov | Partner's latest report + live in-zone recomputation; **pending partners' status withheld** until both sides consent (users.js:432-537 — Phase 2 hotspot S1) |

### C. Reports — the core (`routes/reports.js`, `services/reportStore.js`)

| Capability | Endpoint | Auth | Validation | Realtime |
|---|---|---|---|---|
| Submit / idempotent relay | `POST /api/reports` | `authenticate` + own user-keyed limiter (600/min, excluded from global limiter) | `ReportSchema` | `stats_update` broadcast unless web proxy |
| Public roster search | `GET /api/reports/search` | — | `ReportSearchQuerySchema` | Coarse coords (2-dp), masked phone only |
| Status Overview roster | `GET /api/reports/people` | — | inline | Latest-status-per-person, paginated |
| Rescue triage | `GET /api/reports/rescue` | gov | `RescueQuerySchema` | Full PII+GPS, P1–P4 priority then distance |
| Aggregate stats | `GET /api/reports/stats` | — | inline | `exclude_web=true` default — web proxies never count |

Report ingest guarantees (verified in code):
- **Idempotency:** client UUID is the `_id`; resubmission bumps `relay_count` instead of duplicating; a lost insert race is caught via dup-key 11000 and converted to a relay (reportStore.js:144-198).
- **De-mass-assignment:** non-gov callers cannot set `user_id`/`reported_for_user_id`; identity is derived from the bearer principal (reports.js:93-106).
- **Never-lose:** an unknown `disaster_id` is nulled (stored unlinked) rather than rejected (reports.js:138-144); optional `phone`/`personal_id` stay optional server-side so legacy outbox items are never dropped (zodSchemas.js:118-123).

### D. Geo resources

| Domain | Endpoints (full paths) | Auth (writes) | Store layer? |
|---|---|---|---|
| Shelters | `GET /api/shelters` · `GET /api/shelters/:id` · `POST /api/shelters` · `PUT /api/shelters/:id` · `DELETE /api/shelters/:id` (soft) | `allowGovOrVolunteer` | ❌ inline Mongo in route |
| Safe places (citizen-suggested) | `POST /api/safe-places` (authenticate) · `GET /api/safe-places` · `GET /api/safe-places/pending` · `PUT /api/safe-places/:id/status` | moderation = `allowGovOrVolunteer` | ❌ inline |
| AED | `GET /api/aed` | — | ❌ inline |

All three reuse `boundingBox()`+`haversineKm()` from the shared libs but **copy-paste the candidates→filter→sort loop** (explicit inventory in §2.3).

### E. Disasters & alerting (`routes/disasters.js`, `services/triggerEngine.js`)

| Capability | Endpoint / trigger | Behavior |
|---|---|---|
| List active | `GET /api/disasters` | public |
| Manual trigger | `POST /api/disasters/trigger` (gov) | → `triggerEngine.activateDisaster`: duplicate suppression (same type within 30 km, backstopped by a partial-unique `(type, active)` index for the read-then-write race — triggerEngine.js:353-374) → persist → socket alert to in-radius **mobile** sockets → fire-and-forget push fan-out: direct devices in radius + cascade to *confirmed* loved ones (skipping anyone already alerted directly) → dead-token pruning (triggerEngine.js:390-401) |
| Deactivate | `POST /api/disasters/:id/deactivate` (gov) | `disaster_deactivated` broadcast; mobile gate also self-heals on next poll |
| Mock feed | `ENABLE_MOCK_FEEDS=true` only | 3 rotating HKO-style demo signals, 30 s poll, leader-locked; **entirely absent in default/prod config** (triggerEngine.js:446-460) |

### F. CFR incidents — 999 dispatch (`routes/incidents.js`, `services/incidentEngine.js`)

| Capability | Endpoint | Auth |
|---|---|---|
| Create/dispatch | `POST /api/incidents` | gov (single CAD integration seam; `is_public:false` restricts residential addresses to verified responders) |
| Dispatcher board | `GET /api/incidents/active` | gov |
| Responder feed | `GET /api/incidents/nearby` | citizen token (opt-in responders) |
| Incident detail (nearest AEDs + roster) | `GET /api/incidents/:id` | citizen token, privacy-gated |
| Responder status update | `POST /api/incidents/:id/respond` | citizen token |
| Resolve / stand down | `POST /api/incidents/:id/resolve` | gov |

Matching = radius (per-responder `responder_max_radius_km`) + skill + privacy gate; alerting mirrors the disaster path (socket `incident_alert` + push).

### G. Missing persons (`routes/missingPersons.js`)

| Capability | Endpoint | Auth |
|---|---|---|
| Open a case | `POST /api/missing-persons` | `allowGovOrVolunteer` — emits `missing_alert` |
| List cases | `GET /api/missing-persons` | `allowGovOrVolunteer` — defaults to open (active/investigating) |
| Update case | `PUT /api/missing-persons/:id` | `allowGovOrVolunteer` |
| Close case (soft) | `DELETE /api/missing-persons/:id` | `allowGovOrVolunteer` — sets `case_status='closed'` |

### H. Devices & push (`routes/devices.js`, `lib/pushService.js`, mobile `notificationService.ts`)

| Capability | Endpoint | Auth | Notes |
|---|---|---|---|
| Register device handle | `POST /api/devices/register` | optional bearer (60/min) | token+platform+last location; auth *optional* by design — an anonymous device still receives life-safety alerts; user linkage COALESCEd on upsert |
| Unregister (logout) | `DELETE /api/devices/:token` | owner-or-gov | prevents third parties silencing someone's alerts |

Push transport: native FCM/APNs handles registered through **Azure Notification Hubs** on the server side; clean no-op when unconfigured. (Mobile's `firebase` npm package plays no part in this — see §1.7.)

### I. Admin console (`routes/admin/*` — all 20 endpoints)

All behind `requireSuperAdmin` except login; every mutation writes an audit row; list endpoints support offset and cursor (`?after`) pagination. **Notable: none of the 20 uses a Zod schema — all validation is hand-rolled inline** (contradicts the project's own "validation at the boundary" convention; see §2.4).

| Endpoint | Auth | Behavior |
|---|---|---|
| `POST /api/admin/login` | — (10/15 min limiter) | scrypt password login, phone normalized, audit-logged, returns token pair |
| `GET /api/admin/stats` | super_admin | user counts by role, report counts by status, disaster/device/link/audit totals |
| `GET /api/admin/audit` | super_admin | recent audit entries (max 200), filterable by action/entity |
| `GET /api/admin/users` | super_admin | list w/ search (name/phone/email) + role/user_type/consent/email filters |
| `POST /api/admin/users` | super_admin | create; password required only for super_admin role; audited |
| `PUT /api/admin/users/:id` | super_admin | COALESCE update; self-demotion lockout; passwordless-admin guard; audited |
| `DELETE /api/admin/users/:id` | super_admin | delete + FK cascade emulation; self-deletion blocked; audited |
| `GET /api/admin/reports` | super_admin | urgency-sorted list; q/status/reported_by/user_type/disaster_id filters; joins user name/phone |
| `POST /api/admin/reports` | super_admin | create; audited |
| `PUT /api/admin/reports/:id` | super_admin | COALESCE update; keeps `name_lower` in sync; audited |
| `DELETE /api/admin/reports/:id` | super_admin | delete + status_history cascade; audited |
| `GET /api/admin/disasters` | super_admin | active DESC, severity DESC, started_at DESC; capped 200 |
| `POST /api/admin/disasters` | super_admin | create; audited |
| `PUT /api/admin/disasters/:id` | super_admin | COALESCE update; audited |
| `DELETE /api/admin/disasters/:id` | super_admin | delete; reports.disaster_id nulled; audited |
| `GET /api/admin/links` | super_admin | list; search resolves both parties; joins names/phones |
| `PUT /api/admin/links/:id` | super_admin | status change (pending/confirmed/blocked); stamps confirmed_at; audited |
| `DELETE /api/admin/links/:id` | super_admin | delete; audited |
| `GET /api/admin/devices` | super_admin | located-first list; joins user names/phones |
| `DELETE /api/admin/devices/:id` | super_admin | delete; token truncated to 16 chars in the audit row |

### J. Platform / observability

`GET /api/live` (always 200) · `GET /api/ready` (503 when Mongo, or configured Redis, is down) · `GET /api/metrics` (request count, error rate, avg latency, active sockets — fed by `requestLogger`, logger.js:29-66) · `GET /api/health` (legacy stats). Request IDs propagate via `X-Request-Id`.

## 1.3 Background workers

| Engine | Trigger | Interval | Leader-locked | Reads → writes | Broadcasts |
|---|---|---|---|---|---|
| `triggerEngine` | `startPolling` **only if** `ENABLE_MOCK_FEEDS=true`; otherwise purely on-demand via gov route | 30 s (`DISASTER_POLL_INTERVAL_MS`) | ✅ `runIfLeader('trigger')` | disasters, device_push_tokens, reports, users, account_links → disasters, device token pruning | `disaster_alert`, `loved_one_alert` |
| `incidentEngine` | `startPolling` **only if** `ENABLE_MOCK_999_FEED=true`; otherwise on-demand via `POST /api/incidents` | n/a (mock feed) | — (on-demand path) | incidents, users (responder match), device_push_tokens, aed_locations → incidents, incident_responses | `incident_alert`, `incident_update` |
| `missingPersonService` | always on | 5 min (`MISSING_POLL_INTERVAL_MS`), immediate first tick | ✅ `runIfLeader('escalation')` | reports → reports (`need_help`→`awaiting_response`→`potentially_missing`), status_history | `stats_update` when anything escalated, `missing_alert` |
| `retentionService` | purge only if `RETENTION_DAYS>0`; **erasure-tombstone sweep always runs once at boot** (crash recovery for PDPO deletes) | daily | ✅ `runIfLeader('retention')` / `runIfLeader('erasure-sweep')` | reports, users → deleteMany reports+status_history, finalize user tombstones | — |
| `realtimeService` stats timer | always on | 10 s (`WS_STATS_INTERVAL_MS`) | ✅ `runIfLeader('stats')` | reports aggregate | `stats_update` |

**Escalation invariant worth protecting:** escalation never *lowers* triage priority — `awaiting_response` stays P1 alongside `need_help` (reportStore.js:8-32).

## 1.4 Socket.IO catalog

Client → server: `register` `{lat, lng, userType: mobile|web (default web), userId?}` — the default-to-web means an unidentified socket can never be treated as an affected person (realtimeService.js:51-69).

Server → client:

| Event | Audience | Source |
|---|---|---|
| `disaster_alert` | mobile sockets inside radius only | trigger engine / gov trigger |
| `disaster_deactivated` | global room | deactivate route |
| `stats_update` | global room | ingest + 10 s timer + escalations |
| `missing_alert` | global room | escalation engine, MP case open |
| `loved_one_alert` | mobile sockets of confirmed partners, by userId | trigger cascade |
| `incident_alert` | mobile sockets of matched responders, by userId | incident dispatch |
| `incident_update` | co-responders + dispatcher, by userId | respond route |
| `incident_resolved` | global room | resolve route |

Multi-instance: Redis adapter + `io.fetchSockets()`; each instance's `socketLocations` map only knows its own sockets, which is correct because each instance emits only to sockets it owns.

## 1.5 Logical flow analysis — the four lifecycles that define the system

### Trace A — Citizen report (the "never lost" invariant), mobile → dashboard

1. **Capture** — `ReportScreen.onSubmit` (ReportScreen.tsx:85-154): 8 validation gates (name, phone, HKID format via `utils/hkid.ts`, consent), UUID minted client-side (`expo-crypto`), location resolved with HK-center fallback (`utils/location.ts`).
2. **Durable write FIRST** — `syncService.submitReport` (syncService.ts:37-46) `await outboxDb.enqueue(report)` into expo-sqlite **before any network attempt**; `INSERT OR IGNORE` on the UUID makes duplicate taps no-ops; queue capped at 200 rows with only delivered rows evicted (outboxDb.ts:24,75).
3. **3-layer delivery** — `attemptDelivery` (syncService.ts:51-113): ① online → POST per pending row; 400/422 = permanent → drop (prevents queue rot); 401 `token_expired` → one transparent refresh-and-replay (apiClient.ts:115-145); 5xx/429/network → stays queued. ② offline → mesh peer discovery — **stubbed**: `MockMeshTransport.sendToPeer` always returns `false` so nothing ever falsely claims delivery (MockMeshTransport.ts:41-49). ③ else stays queued.
4. **Auto-flush** — `connectivityWatcher` (connectivityWatcher.ts:32-52) fires `attemptDelivery()` on the offline→online rising edge; oldest first.
5. **Server boundary** — `authenticate` resolves the bearer to a principal (authGuard.js:127-157) → user-keyed ingest limiter → `ReportSchema.safeParse` → identity policy (strip client-supplied identity, derive from principal; gov exempt) → web-proxy rules (no "safe", forced `family` attribution, location resolved from the affected person's own non-web report → else disaster centre → else 422) → unknown `disaster_id` nulled (reports.js:79-159).
6. **Persistence** — `upsertReport` relay-or-insert + `status_history` append (write-only audit trail that must never block the main write — reportStore.js:117-131).
7. **Fan-out** — `broadcastStats(io)` (skipped for web proxies) → every dashboard's `stats_update` listener updates within one tick; the 10 s leader-gated timer converges anything missed.
8. **Escalation tail** — if the reporter goes silent, missingPersonService walks the report `need_help → awaiting_response → potentially_missing` and the roster/gov views re-render via `missing_alert`/`stats_update`.

### Trace B — Disaster trigger → who exactly gets woken up

Gov POST (`ManualDisasterSchema`) → duplicate suppression → insert (race-safe via partial unique index) → **three concentric notification rings**, each with an open-app and a closed-app path:
- Ring 1 (affected): socket `disaster_alert` to in-radius *mobile* sockets; push to in-radius device tokens. Mobile's `DisasterModeContext` flags the id server-side and mounts the **non-dismissable DisasterModeScreen gate** — the only exits are reporting safe/injured/need_help (which enqueues via the same Trace A pipeline, so the gate clears even offline) or acknowledgement.
- Ring 2 (confirmed loved ones): `loved_one_alert` socket (per-affected grouping so relatives are told *who*) + push, excluding anyone already alerted in Ring 1 (triggerEngine.js:287-318).
- Ring 3 (everyone): `stats_update` + banner on web.
Dead push handles (410/404) are pruned after the fan-out. The entire push stage is fire-and-forget so activation never blocks on Azure NH (triggerEngine.js:390-401).

### Trace C — Token lifecycle

Register/login mint an access token (24 h) + refresh token (30 d); **only SHA-256 hashes are stored** (authGuard.js:67-97). Refresh rotates the pair, keeps the *previous* refresh hash as a tripwire, and a replay of the rotated-out token clears the whole family (users.js:224-279). Web receives the refresh token as an httpOnly `SameSite=Strict` cookie path-scoped to the refresh endpoint (XSS can't read it; users.js:14-31); mobile stores it in expo-sqlite and both `submitReport` and `authedRequest` do exactly one transparent refresh-and-replay on `token_expired`.

### Trace D — PDPO erasure (DPP6)

`DELETE /api/users/:id` (owner-or-gov) → `eraseUserData` (reportStore.js:550-592):
1. Scrub PII from the user's reports in place — rows kept so aggregate counts survive, identity fields nulled.
2. Scrub + **tombstone the user doc first** (`deletion_state:'pending'`, phone replaced with per-user sentinel so the unique index can't collide, HKID `$unset` so the sparse-unique index releases it) — a crash after this point can leave only a PII-free tombstone.
3. Cascade deletes (links, device tokens, safe places) in bulk, user doc last.
4. `finalizePendingErasures()` re-runs at every boot (retention service) to sweep tombstones left by a crash. Idempotent end to end.

## 1.6 Configured vs. actual behavior

What the code *contains* vs. what actually *runs* under the default/production configuration:

| Flag / env | Default | Effect when unset | Dormant code paths |
|---|---|---|---|
| `ENABLE_MOCK_FEEDS` | off | trigger engine never polls; disasters only via gov route/seed | `getMockDisasterFeeds`, `checkFeeds`, `feedCursor` (triggerEngine.js:63-85, 415-430) |
| `ENABLE_MOCK_999_FEED` | off | incident engine never polls; incidents only via gov route | mock 999 generator in incidentEngine |
| `OTP_ENABLED` | off | register/login frictionless; `request-otp` returns `enabled:false` | `otpService` verification path |
| `HKID_STRICT` | off | lenient HKID rule (≥1 letter, ≥6 digits, 7–12 chars) | full mod-11 checksum `isValidHKIDChecksum` (zodSchemas.js:63-86) — production-grade code, not enforced |
| `RETENTION_DAYS` | 0 | no purge (erasure sweep still runs at boot) | purge tick |
| `REDIS_*` | absent | single instance: in-memory rate limiting, no socket adapter, every `runIfLeader` is leader | Redis adapter, distributed locks, shared limiter |
| Azure NH push env | absent | push = clean no-op; socket path still delivers to open apps | `pushService` senders |
| `GOV_TOKEN` | built-in default | loud boot warning in production (authGuard.js:49-57) | — |
| `TRUST_PROXY_HOPS` | 0 | prod warning; Azure needs exactly 1 | — |
| `GEO_SCAN_CAP` | 5000 | heap ceiling on every geo box scan | — |

**Take-away:** in the deployed configuration the system is a *reactive* platform — every disaster and incident is human-triggered; the only autonomous behaviors are escalation, the stats heartbeat, and the boot-time erasure sweep. The mock-feed machinery (~150 lines) exists purely for demos.

## 1.7 Dead / vestigial code — verified inventory

### Confirmed dead (safe to delete; nothing imports or calls it)

| Item | Evidence |
|---|---|
| **`mobile/src/firebaseConfig.ts` + `firebase@10.8.0` dependency** | Zero importers of the module anywhere in `mobile/`; push uses expo-notifications + native FCM/APNs handles via Azure NH. The dep audit initially marked firebase "used" because the config file imports it — but the config file itself is unreachable. Removing both cuts a heavyweight package from install and bundle. |
| `web/src/components/StatCard.vue` | Imported by StatusView but never rendered — StatusView inlines equivalent `.callout-card` HTML instead. |
| `web/src/api.js` → `triggerDisaster()` | Exported, never called by any view/component (gov triggers via backend tooling). |
| `mobile/src/api/apiClient.ts` → `listSafePlaces`, `getCurrentUser`, `currentUserRole` | Exported, zero call sites in mobile. |
| Root deps: `domexception`, `web-streams-polyfill` | No imports anywhere; the actual DOMException fix is hand-written in `mobile/polyfills.js` (installed via `mobile/index.js` before socket.io-client loads) and does not use the npm package. |
| Root devDeps: `@babel/plugin-transform-class-properties`, `@babel/plugin-transform-private-methods`, `@babel/plugin-transform-private-property-in-object`, `@expo/ngrok` | No babel config references them (mobile uses only `babel-preset-expo`); no ngrok invocation anywhere. |
| Root devDep `@types/react@~18.3.0` | Stale duplicate — mobile pins `~19.2.14` itself. |
| `mobile` dep `expo-font` | Zero `Font.loadAsync`/`useFonts` imports. |

### Misplaced (works, but wrong manifest section — ships dev tooling as runtime deps)

| Item | Problem |
|---|---|
| Root `dependencies`: `vite@8.0.16` | Build tool in runtime deps of the deployable root; belongs in devDependencies (verify `npm test`/deploy zip after moving — the Azure zip currently excludes node_modules and rebuilds, so risk is low). |
| `mobile` `dependencies`: `vite`, `vitest` | Test/build tooling declared as app runtime deps. `vite` appears entirely removable (mobile's vitest config imports `vitest/config`, not vite). |
| `mobile` deps `react-dom`, `react-native-web`, `@expo/metro-runtime` | **Not dead** — they back the `expo start --web` script and `userStorage.web.ts`. Decision required: if the Expo-Web dev target is wanted, keep all three (and move nothing); if not, remove all three plus `userStorage.web.ts` and the `web` script together. |

### Vestigial by design (keep, but label clearly)

| Item | Status |
|---|---|
| `mobile/src/mesh/IMeshTransport.ts` + `mobile/src/mesh/MockMeshTransport.ts` | Deliberate seam for a future BLE/WiFi-Direct transport. The stub is *honest* — `sendToPeer` always returns false so no report ever falsely leaves the outbox. Cost: syncService's "Layer 2" (syncService.ts:91-104) executes a 500 ms fake peer-discovery on every offline attempt for zero benefit. Recommendation: keep the interface, short-circuit the layer behind a `MESH_ENABLED` flag. |
| Mock feed generators (both engines) | Demo-only, correctly flag-gated. |
| `authGuard.generateAccessToken` | Used only by `tests/auth.test.js` + `tests/hardening.test.js` — superseded in production by `generateTokenPair`. Either migrate the tests or mark it test-only. |

### Orphaned files & doc rot

| Item | Finding |
|---|---|
| `inspect-db.cjs`, `scripts/backup-db.ps1`, `scripts/backup-db.sh`, `server/scripts/fillDatabase.js` | Referenced by no script, workflow or doc (manual one-offs). Keep only if actively used by a human; otherwise delete or document in README. |
| `DEPLOYMENT.md` | Says **Node 20**; README + CLAUDE.md say Node 22 LTS (the real Azure runtime). Also overlaps DEPLOYMENT_AZURE.md — consolidate to one deployment doc. |
| `.github/workflows/ci.yml` | Tests on Node **20** while production runs Node **22** — align the matrix. |
| `Emergency Operations Dashboard.html` (untracked, 36.5 KB) | Standalone design mockup, different design-token system from the shipped views; not part of any build. Move to a `design/` folder or delete. |
| `.claude/launch.json` (untracked) | Local dev-launch convenience for the web dev server; harmless — gitignore or track deliberately. |
| `web/src/hkid.test.js`, `web/src/iconography.test.js` | **Live**, not dead — the root Vitest config has no `include` override so its default glob picks them up under `npm test`. |

---

# PHASE 2 — Development Entropy & Complexity Audit

## 2.1 Entropy scoreboard

| Signal | Measured value | Where |
|---|---|---|
| `console.*` in request/engine paths (vs. own convention) | **117 calls / 27 files** (vs. 37 `logger.*` in 9 files) | all of `routes/`, `reportStore`, engines |
| Hand-rolled `try/catch → 500` per handler | ~60 handlers, near-identical | every route file |
| Repeated `safeParse` 4-line block | 15+ sites | every schema'd route |
| Admin endpoints with **zero** Zod | 20 / 20 | `routes/admin/*` |
| Auth middlewares sharing ~80 % logic | 4 | authGuard.js:108-254 |
| `fetchSockets()`-loop broadcasts differing only in predicate | 4 | realtimeService.js:108-210 |
| Copy-pasted geo box→haversine→sort loop | 5 files | shelters, safePlaces, aed, incidents, triggerEngine |
| Remediation ticket codes in comments (`M1`, `H3`, `B2`, `C2` and similar) | ~50 across 24 files | server-wide |
| `ponytail:` private marker | 8 occurrences | server, mobile, config |
| Files > 500 lines | 7 (GovView 904, messages.js 823, i18n.ts 701, AccountScreen 667, reportStore 640, SheltersView 600, apiClient 580) | all workspaces |
| Domains with no data-access layer | 6 of 7 | shelters, safe places, incidents, MP, devices, AED |

## 2.2 Cognitive overhead & deep nesting — the ranked hotspots

### Server

**S1 — `routes/users.js:432-537` · `GET /:id/links` (105 lines, the single worst handler).** Five responsibilities interleaved in one closure: authorization → link query → active-disaster load + a locally-defined `inAnyActiveZone` geo closure → partner join → per-partner latest-report resolution (concurrent, but keyed through a Map built from a `Promise.all` of filtered tuples) → row shaping inside a `for` loop with a four-variable mutable prelude (`let report_status = null, status_updated_at = null, disaster_id = null, in_affected_zone = false;`) → custom two-key sort → response. The reader must hold link direction (`user_a`/`user_b`), consent semantics, geo state and pagination shape simultaneously. *Refactored in full in §4.3.*

**S2 — `routes/reports.js:79-159` · `POST /` (81 lines, 7 responsibilities).** Validation, de-mass-assignment, web-proxy branching (nested 3 deep: `if web → if safe → return; if no coords → resolve → if !loc → return`), FK-soft-check, persistence, conditional broadcast, and the catch-tail — all in one handler. It is the most security-sensitive handler in the system, which makes its branch density a real risk for future edits. *Refactored in full in §4.2.*

**S3 — `routes/users.js:224-279` · token refresh.** Nesting depth 4; the reuse-detection sub-case (second `findOne` + family nuke) is inlined in the "not found" branch of the first lookup. Correct, but the *most* security-critical 20 lines in the file read as an afterthought inside an else-path.

**S4 — `services/triggerEngine.js:326-408` · `activateDisaster` + cascade.** Orchestrates 6 concerns (dedupe, persist, race-recovery, socket, push fan-out, pruning) with a fire-and-forget async IIFE whose failures reduce to one `console.error`. The helpers themselves (`findLovedOneDevices` with its double-loop fan-out at 231-243) are fine individually; the orchestration layer has no seams for testing the rings independently.

**S5 — `routes/incidents.js:185-240` · `POST /:id/respond`.** Six sequential awaits (incident lookup, gate check, upsert, roster fetch, broadcast) where at least two are independent.

**S6 — `routes/admin/*.js` COALESCE ladders.** `PUT /users/:id` (admin/users.js:105-163) and its reports/disasters twins each hand-roll 6-10 lines of `const v = blank(x); if (v !== null) set.x = v;` — three private re-implementations of "patch only provided fields".

**S7 — `services/reportStore.js` as a grab-bag.** 640 lines named "reportStore" that also owns user search, the public roster, shelters-by-radius, phone masking, and the PDPO erasure cascade. Each function is individually clean; the module boundary is the entropy (it's the *only* store, so everything gravitated into it).

### Web

**W1 — `GovView.vue` (904 lines).** One `<script setup>` (~350 lines) owns: session-token gate + modal, 5-call parallel `fetchAll`, 4 socket subscriptions, refresh debouncing, triage bucketing (P1/P2/P3), map-scope filtering, command-stats derivation, and ~80 lines of SVG radar-chart trigonometry — a chain of computeds (`filteredResults → p1/p2/p3 → cmdStats → radarPct → radarPts → polygon points`) spanning 135 lines with no intermediate functions. The radar math alone is a pure function begging to be `radarChart.js`.

**W2 — `AdminView.vue:107-142` · `loadTab`.** A 35-line if/else ladder — one branch per tab, each duplicating the same fetch→reshape→total→offset dance. Adding a tab means editing four places (ladder, tab list, columns map, form map).

**W3 — `SheltersView.vue:175-214` · save handler.** 40-line single block: validation + coercion + create/update branch + modal state + error handling. Same shape as the server handlers — the try/catch-everything idiom crossed the stack.

### Mobile

**M1 — `DisasterModeContext.tsx:268-374` · the mega-effect.** One `useEffect` initializes storage-loaded acks, two notification tap listeners, initial fetch, location resolution, push registration, the socket connection and **8 socket handlers**, each mutating overlapping state through 5 refs kept in sync with state (`disastersRef`, `locRef`, `ackRef`, `serverFlaggedRef`, `loadedRef`) to dodge stale closures. The dependency array `[refresh, recompute, applyDisasters, openIncident]` means any identity change re-runs the whole subsystem. It works, but it is the file everyone will fear to touch.

**M2 — `AccountScreen.tsx` (667 lines).** Login + 2-step registration + profile display + CFR opt-in editor as one component with a hand-rolled state machine (`mode`, `regStep`, 10+ useStates).

**M3 — `ReportScreen.onSubmit` (85-154).** An 8-gate validation gauntlet inline in the submit handler, then three result branches. Fine at current size, but the validation belongs beside `hkid.ts` as a pure `validateReportForm(form): error | null`.

## 2.3 Leaky abstractions & boundary violations

### Backend persistence leaks — explicit inventory (routing layer touching the database directly)

Every site below is a raw `collection()` query, an upsert-semantics decision, or a Mongo error-code branch living **inside the HTTP routing layer** instead of behind a store:

| Route file | Lines | What leaks |
|---|---|---|
| `routes/reports.js` | 16-24, 26-40, 43-54 | Three data-access helpers (`latestNonWebLocation`, `resolveProxyLocation`, `resolveReportedForUser`) — reports/disasters/users queries defined in the route module |
| `routes/reports.js` | 139 | `disasters` existence probe inline in the POST handler |
| `routes/users.js` | 145-149, 185-201, 232-266 | `users` upsert with `$setOnInsert` COALESCE semantics (register), token-update writes (login), the entire refresh-rotation + reuse-detection query sequence |
| `routes/users.js` | 286-291, 315-319, 357-367 | profile projection, PATCH `findOneAndUpdate`, responder `findOneAndUpdate` |
| `routes/users.js` | 386-402, 414-417, 436-478, 543-546 | link upsert, link confirm, the roster's four-collection join, link delete |
| `routes/users.js` | 64-67, 164-166, 324-326 | Mongo duplicate-key knowledge (`err.code === 11000`) branching to 409 inside route handlers |
| `routes/disasters.js` | 18-21, 62-65 | active-disaster list scan; deactivate `findOneAndUpdate` |
| `routes/shelters.js` | 30-44, 54-56, 64-85, 93-121, 124-135 | geo query + CRUD, all inline |
| `routes/safePlaces.js` | 32-44, 38, 90-113, 116-138 | geo query, `disasters` FK probe, moderation queue, status update |
| `routes/devices.js` | 28-36, 60-88 | token upsert + owner-scoped delete (simple CRUD — lowest-severity leak) |
| `routes/incidents.js` | 32-41, 45-64, 90-112, 143-156, 185-240 | AED lookup, roster aggregation, dispatcher board, nearby feed, respond upsert |
| `routes/missingPersons.js` | 27-28, 37-64, 68-88, 91-106 | case CRUD inline |
| `routes/aed.js` | 26-33 | geo query inline |
| `routes/admin/{users,reports,disasters,links,devices}.js` | throughout (e.g. admin/users.js:105-163) | full CRUD + join queries inline in all five files |

### Geospatial schema bleed — the bounding-box filter hand-built in the routing layer

The index-friendly box filter shape (`lat: { $gte: bb.latMin, $lte: bb.latMax }, lng: { $gte: bb.lngMin, $lte: bb.lngMax }`) plus the exact-haversine refine loop is re-assembled at each of these sites instead of being one function:

| Site | Lines | Drift already visible |
|---|---|---|
| `routes/shelters.js` | 33-39 | sorts `lat:1` "for deterministic cap" |
| `routes/safePlaces.js` | 35-45 | different projection + cap handling |
| `routes/aed.js` | 30-33 | functional map/filter/sort variant |
| `routes/incidents.js` | 143-156 | inline in the nearby feed |
| `services/triggerEngine.js` | 104-118, 127-139, 150-172 | three more copies inside one file |
| `services/incidentEngine.js` | 45, 91 | uses `boxFilter()` (the one site that adopted the shared helper) |

The five route-layer copies each re-decide projection, scan cap and sort key — they have already diverged.

### Other boundary violations

**Policy logic lives inside handlers.** The web-proxy rulebook (who may report what about whom, where locations come from) exists only as branches inside `POST /reports`; the loved-one consent rule ("pending partners' status withheld") exists only as an `if` inside `GET /:id/links`. Neither is testable without spinning up Express.

**Presentation reaches into transport on the clients.** Every Vue view owns its own fetch+poll+socket lifecycle against the raw `api.js` (52 hand-rolled functions); every mobile screen calls `apiClient` directly. There is no shared "server state" seam, so cross-view consistency is maintained by the socket events plus luck — StatusView even hand-rolls a `lastUpdatedBySocket` timestamp to stop a slow HTTP response from overwriting a fresher socket push (StatusView.vue:62-92): a race-condition patch that a tiny shared data layer would make unnecessary.

**Two logging systems, split mid-codebase.** `lib/logger` (structured JSON, levels, reqId, feeds `/api/metrics` latency/error counters) is used by index.js, realtimeService and libs; the other 27 files use bare `console.*`. Error *counters* survive (requestLogger hooks `res.finish`), but the 117 console sites lose reqId correlation, level filtering and machine-parseability — exactly the observability the project built and then didn't use.

## 2.4 Redundant layers / boilerplate

| Redundancy | Cost | Consolidation |
|---|---|---|
| 4 auth middlewares: `authGuard`, `authenticate`, `allowGovOrVolunteer`, `requireSuperAdmin` — same bearer-parse → gov-compare → hash-lookup → expiry-check skeleton, different role filter (authGuard.js:108-254) | 4 places to patch any token bug | One `resolvePrincipal` + `requireRole(...roles)` factory |
| 4 broadcast loops: `broadcastLovedOneAlert`, `broadcastResponderAlert`, `broadcastIncidentUpdate` identical except predicate; `broadcastDisasterAlert` adds a radius check (realtimeService.js:108-210) | Any adapter/fetchSockets change lands 4× | `emitToUsers(io, userIds, event, payload, {mobileOnly})` + `emitInRadius(...)` |
| Per-route `safeParse` + 400 block (15+ sites) and per-route try/catch → `console.error` → 500 (~60 sites) | ~500 lines of ceremony; inconsistent admin validation | `validate(schema)` + `asyncHandler` + central `errorHandler` (§4.2) |
| 3 COALESCE ladders in admin routers | drift already visible (reports also syncs `name_lower`, others don't) | `pickProvided(body, fields)` helper |
| `web/src/api.js` — 52 near-identical fetch wrappers (376 lines) | every new endpoint = another hand-rolled wrapper | one `request(method, path, {body, token, query})` core + thin named exports |
| Login-screen markup+CSS duplicated between AdminView and GovView (~40 lines markup + ~25 lines CSS) and 4 views re-implementing the same data-table shell | the current uncommitted redesign had to touch both files in parallel — the duplication tax is already being paid | `LoginPanel.vue` + `DataTable.vue` |

**What is *not* redundant (checked and cleared):** `mongoMap.js` (a deliberate consolidation of 4 helpers that were previously copy-pasted in six files), `leaderLock.js` (44 lines, three call-sites, honest about its non-fencing semantics), the destructure-to-omit mappers (`publicUser`/`fromDoc` — load-bearing PII strippers), and the platform-split `userStorage.{native,web,d}.ts` (Metro resolution, both variants used).

## 2.5 Cross-workspace duplication

| Logic | Copies | Risk |
|---|---|---|
| HKID normalize/validate | `server/lib/zodSchemas.js:38-86` (lenient + strict), `web/src/hkid.js`, `mobile/src/utils/hkid.ts` (lenient only, functionally identical) | A rule change (e.g. enabling strict mode) must land 3× or clients will pre-reject/pre-accept what the server won't |
| Phone normalization (+852) | same 3 files | same |
| Severity ranking | `mobile/src/utils/severity.ts` mirrors server logic | new severity label silently sorts to 0 on mobile |
| Status vocabulary + colors | server `ALL_STATUSES`/`STATUS_PRIORITY`, web `iconography.js` (196 lines), mobile `theme.ts` | web already shows drift: three different access patterns for the same color map (helper fn vs. direct import vs. object lookup) |
| i18n dictionaries | web `messages.js` 823 lines / mobile `messages.ts` 701 lines, ~40 shared keys (status, severity, disaster/shelter types, visibility, time) | a new disaster type = 2 dictionary edits + 2 vocab edits |

## 2.6 Comment archaeology

The server narrates its own audit history: ~50 remediation codes across 24 files (`// H3: deliver the refresh token`, `// C1 — de-mass-assignment`, `(M5)`, `(B2/H1)`), 8 `ponytail:` markers (a private "known-limitation" convention explained only in `remediation/POST_REMEDIATION_REVIEW.md:106`), and pervasive SQL-era narration in a MongoDB codebase (`the former Postgres 23505`, `mirrors the SQL JOIN's fan-out`, `INSERT ... ON CONFLICT` comparisons, `PostGIS-free math`, `COALESCE semantics` — reportStore.js, users.js, triggerEngine.js throughout). Individually harmless; collectively they make every file read like a changelog. A newcomer cannot resolve `M5` or `ponytail` without excavating `remediation/`. The *content* of many of these comments is valuable (they encode real invariants like "escalation must never lower priority") — the fix is to keep the invariant sentence and drop the ticket-code framing and the dead-database comparisons.

## 2.7 Deliberate complexity that must NOT be "cleaned" (fairness section)

Flagging these so a future simplification pass doesn't destroy load-bearing design:

- **Destructure-to-omit** in `publicUser`/`fromDoc` — the "unused" bindings are the PII filter (`.eslintrc ignoreRestSiblings` exists for this).
- **Two-phase erasure with tombstones** (reportStore.js:550-619) — looks over-engineered; is actually the PDPO crash-safety guarantee.
- **Bounding-box + exact-haversine double filter** — not redundant; the box is the index-friendly superset, the haversine is correctness.
- **Ingest limiter separate from the global limiter, keyed by user** — carrier-NAT protection; folding it into the global limiter would break disaster-surge behavior (guardrail #3).
- **`GEO_SCAN_CAP` in-memory sorts** — a deliberate RU/heap ceiling for Cosmos free tier, not naïveté (guardrail #1).
- **Report `phone`/`personal_id` optional at the schema layer while mandatory in the client forms** — the never-lose-a-report contract for legacy outbox items.
- **The always-false mesh stub** — honesty about undelivered reports; do not make it "succeed".

---

# PHASE 3 — The "Simple & Clean" Target Architecture

## 3.1 The rationalized tech stack

The runtime stack is already close to minimal — the fat is in the manifests, not the frameworks. **Keep: Express 4 + Zod + mongodb driver + Socket.IO (+ optional redis) · Vue 3 + vue-router + Leaflet + socket.io-client · Expo/RN + the 7 expo modules actually imported + netinfo + socket.io-client.** No new frameworks are warranted: no ORM (the driver + stores is the right weight for Cosmos-RU discipline), no Pinia (a 30-line composable covers the web's needs), no react-query (the mobile data flow is push-driven).

**Remove (12 packages):**

| Manifest | Remove | Why |
|---|---|---|
| root `dependencies` | `domexception`, `web-streams-polyfill` | unused (polyfill is hand-written in mobile) |
| root `devDependencies` | `@babel/plugin-transform-class-properties`, `@babel/plugin-transform-private-methods`, `@babel/plugin-transform-private-property-in-object`, `@expo/ngrok`, `@types/react` | orphaned / stale duplicate |
| mobile `dependencies` | `firebase` | dead module chain (§1.7) — biggest single win: install weight + native build surface |
| mobile `dependencies` | `expo-font` | zero imports |
| mobile `dependencies` | `vite` | not imported (vitest brings its own) |

**Move / decide:**

| Item | Action |
|---|---|
| root `vite` | dependencies → devDependencies (verify deploy zip unaffected — it rebuilds on Azure) |
| mobile `vitest` | dependencies → devDependencies |
| mobile `react-dom` + `react-native-web` + `@expo/metro-runtime` | **Decision:** keep the Expo-Web dev target (keep all three) or drop it (remove all three + `userStorage.web.ts` + the `web` script). Recommend dropping — the web workspace already serves the browser use-case, and mobile-web is untested surface. |
| CI Node 20 vs prod Node 22 | align `.github/workflows/ci.yml` to 22 |

## 3.2 Structural re-architecture — a Pragmatic Modular Monolith

The system is one deployable and should stay one (guardrails #1/#7 depend on it). The correction is *internal*: group by **domain**, not by technical layer, and give every domain the same three-file anatomy so knowing one module means knowing all of them.

```
server/src/
  index.js                 # bootstrap ONLY (env, db, engines, listen, shutdown)
  app.js                   # express wiring: middleware chain + mountRoutes(app, io)
  http/
    middleware.js          # securityHeaders, cors, requestLogger, rate limiters
    validate.js            # validate(schema, source) → req.valid
    asyncHandler.js        # rejection → next(err)
    errors.js              # HttpError + central errorHandler (exposes 4xx messages)
    auth.js                # resolvePrincipal + requireRole('gov'|'owner'|'volunteer'|'super_admin')
  realtime/
    io.js                  # initSocketIO + socketLocations + register handler
    hub.js                 # emitGlobal / emitToUsers / emitInRadius  (the ONE broadcast impl)
    events.js              # SOCKET_EVENTS + GLOBAL_ROOM
  db/
    mongo.js  setup.js  seed.js  seedAdmin.js
  lib/                     # pure, dependency-free helpers only
    geo.js                 # + findWithinRadius(coll, {lat,lng,radiusKm,filter,project,cap})
    logger.js  audit.js  mongoMap.js  leaderLock.js  otp.js  push.js  redis.js
  domains/
    reports/    routes.js  store.js  policy.js  schemas.js
    users/      routes.js  store.js  tokens.js  schemas.js
    links/      routes.js  store.js  schemas.js
    disasters/  routes.js  store.js  engine.js  schemas.js
    incidents/  routes.js  store.js  engine.js  schemas.js
    shelters/   routes.js  store.js  schemas.js
    safePlaces/ missingPersons/ devices/ aed/          # same anatomy
    admin/      routes.js  schemas.js   (reuses the domain stores — no private queries)
  jobs/
    escalation.js  retention.js        # thin ticks over store functions
```

**The module contract (the whole pattern in five sentences):**
1. `routes.js` — parse (via `validate`), authorize (via `requireRole`/ownership), call one store/policy function, shape the envelope. **Nothing else.** Target ≤ 15 lines per handler.
2. `store.js` — *all* Mongo access for the domain's collections; returns app-shaped objects (`_id→id`, secrets stripped) — a raw doc never crosses the store boundary.
3. `policy.js` — only where non-trivial business rules exist (reports proxy rules, link consent); pure or store-composing functions, unit-testable without HTTP.
4. `schemas.js` — the domain's Zod (split out of the current 352-line `zodSchemas.js`), including the admin variants so admin stops hand-rolling.
5. `engine.js` — background behavior for the domain, calling the same store + hub.

**Web target shape** (no framework change): extract `LoginPanel.vue`, `DataTable.vue`; add `composables/useLiveQuery.js` (fetch + socket-invalidate + poll fallback — deletes the per-view timers and StatusView's race patch); split GovView into `GovLogin`, `TriagePanel`, `CommandStats` (+ pure `lib/radar.js`), `DispatchPanel` around the existing `LeafletMap`; collapse `api.js` onto one `request()` core. AdminView's `loadTab` ladder becomes a `TAB_CONFIG` map (`{fetch, columns, form}` per tab) driving one generic loader.

**Mobile target shape:** split `DisasterModeContext` into three providers layered in `App.tsx` — `ServerConnection` (socket + connectivity + stats), `DisasterGate` (disasters, acks, zone recompute, gate selection), `IncidentDuty` (responder alerts/roster) — each with a focused effect; split `AccountScreen` into `LoginFlow` / `RegisterFlow` / `ProfilePanel` / `ResponderSettings`; hoist `validateReportForm` next to `hkid.ts`; short-circuit mesh Layer 2 behind `MESH_ENABLED`.

**Shared vocabulary:** create `shared/` (a plain folder or a `packages/shared` workspace) holding `statuses.js` (names, priorities, colors), `hkid.js`, `phone.js`, `severity.js`, and the ~40 common i18n keys. Server imports it directly; web via Vite alias; mobile via Metro `watchFolders`. If Metro plumbing proves annoying, the fallback is a **CI sync check** (fail the build when the three copies diverge) — cheaper than a package and still kills silent drift.

## 3.3 Data & state simplification

**One request pipeline, no exceptions (admin included):**

```
request
  → security / cors / requestLogger / rate-limit      (http/middleware)
  → validate(schema)          → req.valid              (400s end here)
  → requireRole / ownership   → req.auth               (401/403s end here)
  → handler: policy + store calls                      (throws HttpError for 4xx)
  → res.json({ ok:true, data, meta? })                 (one success envelope everywhere)
  → asyncHandler → central errorHandler                (the ONLY try/catch; logs w/ reqId)
```

Error responses **preserve the existing client contract** — `{ error: <string>, code? }` — gaining only a `reqId` field (see the errorHandler in §4.2). This deletes the three per-route ceremonies (safeParse block, try/catch tail, console.error) in one move and makes admin validation identical to citizen validation without breaking a single client parser.

**One transformation point per direction.** Client → server: Zod transforms (phone/HKID normalization) — already right, keep. Server → client: the store's mapper (`publicUser`-style) — the *only* place `_id` renaming and secret-stripping happens. Everything between handles app-shaped objects; intermediate reshaping layers (per-route row builders like the links handler's) collapse into the store.

**Realtime through one hub.** `hub.emitGlobal(event, payload)` / `hub.emitToUsers(userIds, event, payload, {mobileOnly})` / `hub.emitInRadius(center, radiusKm, event, payload)`. Engines and routes stop iterating sockets themselves; the mobile-only and identity rules live in exactly one file.

**Client server-state in one seam per app.** Web: `useLiveQuery(fetcher, {invalidateOn: [events], pollMs?})` — every view keeps its own local UI state but shares the fetch/invalidate discipline. Mobile: the three split contexts above; screens consume context + `apiClient`, never raw sockets.

**Explicitly unchanged:** the mobile outbox pipeline (Trace A) — it is the best-designed subsystem in the codebase; the Cosmos-shaped query strategy (box prefilter, scan caps, no dedicated throughput); all eight CLAUDE.md guardrails.

---

# PHASE 4 — Implementation Blueprint & Concrete Refactoring Examples

## 4.1 Architectural guardrails for the next developer

1. **Handlers are ≤ 15 lines and nesting-free: guard clauses only, no `else` after a `return`.** Every error state exits immediately (`throw new HttpError(4xx, msg)` or early return). If a handler needs a second level of `if`, the logic belongs in `policy.js` or `store.js`.
2. **No business logic or `collection()` calls in `routes.js` files — ever.** A route parses, authorizes, delegates to one domain function, and shapes the envelope. All Mongo access lives in the domain's `store.js`, and raw Mongo docs never cross the store boundary un-mapped (secrets stripped, `_id→id` at that line and nowhere else).
3. **Validation happens once, at the boundary, via `validate(schema)` — including admin routes.** Handlers read `req.valid` and never touch `req.body`/`req.query` for validated shapes. New input rules go in the domain's `schemas.js`, never inline.
4. **One error path, one logger.** No per-route try/catch; `asyncHandler` + the central `errorHandler` own failures. `console.*` is banned outside `db/` CLI scripts (enforce with ESLint `no-console`); every log is `logger.level('event_name', {reqId, ...fields})`.
5. **One implementation per concept — adding a second is a refactor, not an addition.** Token auth = `requireRole`; radius queries = `geo.findWithinRadius`; broadcasts = `realtime/hub`; partial updates = `pickProvided`. If a change needs a variant, parameterize the existing one; a PR that introduces a parallel copy of an existing concept must delete the old one.

*(Standing constraints from CLAUDE.md remain in force above all of these: Cosmos free-tier throughput rules, exact `trust proxy` hops, fail-closed rate limiting, web-is-proxy-only, PII mapping through `publicUser`/`fromDoc`, PDPO consent + erasure, graceful degradation of optional integrations, and the register/gender contract.)*

## 4.2 Refactoring example 1 — `routes/reports.js` (hotspot S2)

### Before — the complete current file (`server/src/routes/reports.js`, 227 lines, verbatim)

```js
'use strict';

const express = require('express');
const { ReportSchema, RescueQuerySchema, ReportSearchQuerySchema } = require('../lib/zodSchemas');
const { authGuard, authenticate } = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');
const { collection } = require('../db/mongo');
const reportStore = require('../services/reportStore');
const realtimeService = require('../services/realtimeService');

/**
 * Web is proxy-only (A6): a web report carries no browser location. Resolve the
 * affected person's location from their OWN (non-web) report, falling back to
 * the disaster centre. Returns null if the person has no known location yet.
 */
async function latestNonWebLocation(filter) {
  const r = await collection('reports')
    .find({ ...filter, user_type: { $ne: 'web' } })
    .project({ lat: 1, lng: 1 })
    .sort({ updated_at: -1 })
    .limit(1)
    .toArray();
  return r.length ? { lat: r[0].lat, lng: r[0].lng } : null;
}

async function resolveProxyLocation(data) {
  if (data.personal_id) {
    const loc = await latestNonWebLocation({ personal_id: data.personal_id });
    if (loc) return loc;
  }
  if (data.phone) {
    const loc = await latestNonWebLocation({ phone: data.phone });
    if (loc) return loc;
  }
  if (data.disaster_id) {
    const d = await collection('disasters').findOne({ _id: data.disaster_id }, { projection: { lat: 1, lng: 1 } });
    if (d) return { lat: d.lat, lng: d.lng };
  }
  return null;
}

/** Resolve the affected person's user id from HKID then phone, for identity linking. */
async function resolveReportedForUser(data) {
  if (data.reported_for_user_id) return data.reported_for_user_id;
  if (data.personal_id) {
    const u = await collection('users').findOne({ personal_id: data.personal_id }, { projection: { _id: 1 } });
    if (u) return u._id;
  }
  if (data.phone) {
    const u = await collection('users').findOne({ phone: data.phone }, { projection: { _id: 1 } });
    if (u) return u._id;
  }
  return null;
}

/**
 * Build the /api/reports router.
 * @param {import('socket.io').Server} io Socket.IO instance for live broadcasts.
 * @returns {import('express').Router}
 */
module.exports = function createReportsRouter(io) {
  const router = express.Router();

  // Report-ingest limiter (B2/H1): separate from the global /api limiter and
  // keyed by USER (post-auth), not raw IP — so carrier-NAT users sharing an
  // egress IP don't throttle each other during a real surge. Higher ceiling
  // because a disaster legitimately produces many reports per user device.
  const ingestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.REPORT_RATE_LIMIT_PER_MIN) || 600,
    keyFn: (req) => req.auth?.userId || `gov:${req.ip}`,
    message: 'Report ingest rate limit reached — your queued reports will retry automatically.',
  });

  // POST /api/reports — submit (or relay) a status report. Authenticated (C1):
  // an anonymous client can no longer inject reports attributed to arbitrary
  // users/HKIDs. Identity is DERIVED from the principal, never trusted from the
  // body — the one exception is the gov/admin token (trusted tooling).
  router.post('/', authenticate, ingestLimiter, async (req, res) => {
    try {
      const parsed = ReportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.errors });
      }

      const data = parsed.data;

      // C1 — de-mass-assignment. A normal user may not set identity/attribution
      // fields: the server derives them from req.auth. Gov/admin is trusted and
      // may set them explicitly (admin edits, tests, backfills).
      if (req.auth.kind !== 'gov') {
        delete data.user_id;
        delete data.reported_for_user_id;
        if (data.user_type === 'web') {
          // Proxy report by a logged-in family member about someone ELSE — never
          // the submitter's own report. reported_for_user_id is resolved below.
          data.reporter_name = req.auth.user?.name || data.reporter_name || null;
        } else {
          // Self report: attribute it to the authenticated user.
          data.user_id = req.auth.userId;
          data.reported_by = 'self';
          data.reporter_name = null;
        }
      }

      if (data.user_type === 'web') {
        // Web proxy reporters cannot mark someone as "safe" — only the affected
        // person can confirm their own safety, and they do so via the mobile app.
        if (data.status === 'safe') {
          return res.status(422).json({
            error: 'Web proxy reports cannot use status "safe". The affected person must confirm their own safety via the mobile app.',
          });
        }
        // Proxy report (A6): force family attribution, identity-link to the
        // affected person, and never trust a browser-supplied location.
        data.reported_by = 'family';
        data.reported_for_user_id = await resolveReportedForUser(data);
        if (data.lat == null || data.lng == null) {
          const loc = await resolveProxyLocation(data);
          if (!loc) {
            return res.status(422).json({
              error: 'No known location for the affected person yet — they need to share their status from the mobile app, or include a disaster_id.',
            });
          }
          data.lat = loc.lat;
          data.lng = loc.lng;
        }
      } else if (data.lat == null || data.lng == null) {
        return res.status(400).json({ error: 'lat and lng are required.' });
      }

      // Invariant #1 (never lose a report): the old schema's FK on disaster_id
      // would reject an unknown id, so the route stored the report unlinked.
      // MongoDB has no FK to violate, so we proactively null an unknown
      // disaster_id to preserve that exact outcome (a clean, unlinked report).
      if (data.disaster_id) {
        const known = await collection('disasters').findOne({ _id: data.disaster_id }, { projection: { _id: 1 } });
        if (!known) {
          console.warn(`[routes/reports POST /] unknown disaster_id "${data.disaster_id}" — storing report unlinked`);
          data.disaster_id = null;
        }
      }
      const result = await reportStore.upsertReport(data);

      // Web proxy reports are excluded from public stats (getStats excludeWeb=true)
      // and must never trigger disaster alerts — only mobile reports count toward
      // affected-person totals and realtime broadcasts.
      if (data.user_type !== 'web') {
        await realtimeService.broadcastStats(io);
      }

      return res.status(201).json({ ok: true, data: { id: result.id } });
    } catch (err) {
      console.error('[routes/reports POST /] failed to store report:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/reports/search?q=&limit=&offset= — public name search (coarse location only).
  router.get('/search', async (req, res) => {
    try {
      const parsed = ReportSearchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
      }
      const { q, limit, offset } = parsed.data;
      const results = await reportStore.searchByName(q, { limit, offset });
      return res.json({ ok: true, data: results, meta: { limit, offset } });
    } catch (err) {
      console.error('[routes/reports GET /search] failed to search:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/reports/people?limit=&offset=&status= — public Status Overview roster
  // (name + masked phone + gender + status, no auth required). Optional `status`
  // filters to one bucket (drives the dashcard click-through).
  router.get('/people', async (req, res) => {
    try {
      const limit = req.query.limit;
      const offset = req.query.offset;
      const status = req.query.status || undefined;
      const { rows, total } = await reportStore.listPeople({ limit, offset, status });
      return res.json({ ok: true, data: rows, meta: { limit, offset, total, status } });
    } catch (err) {
      console.error('[routes/reports GET /people] failed to list people:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/reports/rescue?lat=&lng=&radius= — privileged triage view.
  router.get('/rescue', authGuard, async (req, res) => {
    try {
      const parsed = RescueQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: 'Validation failed', details: parsed.error.errors });
      }
      const { lat, lng, radius, limit, offset } = parsed.data;
      const results = await reportStore.getRescueView(lat, lng, radius, { limit, offset });
      return res.json({ ok: true, data: results, meta: { limit, offset } });
    } catch (err) {
      console.error('[routes/reports GET /rescue] failed to build rescue view:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/reports/stats — aggregate counts. Official counts EXCLUDE web (proxy)
  // reporters by default (H5/B7) so this REST path agrees with the socket
  // stats_update broadcast (realtimeService always excludeWeb). Pass
  // ?exclude_web=false to get combined counts.
  router.get('/stats', async (req, res) => {
    try {
      const excludeWeb = req.query.exclude_web !== 'false';
      const stats = await reportStore.getStats({ excludeWeb });
      return res.json({ ok: true, data: stats });
    } catch (err) {
      console.error('[routes/reports GET /stats] failed to get stats:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
```

### After — four complete files

**New file: `server/src/lib/http.js`** — the kernel every route shares.

```js
'use strict';

/**
 * Operational error a handler may throw. `expose` marks the message as safe to
 * return to the client (all 4xx); 5xx keep the generic envelope.
 */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = status < 500;
  }
}

/** Route a rejected async handler into the central errorHandler. */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Parse req[source] with a Zod schema. 400 with details on failure; the parsed
 * (transformed) value lands on req.valid. Handlers never touch req.body again.
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const parsed = schema.safeParse(req[source]);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
  }
  req.valid = parsed.data;
  return next();
};

module.exports = { HttpError, asyncHandler, validate };
```

**Changed file: `server/src/lib/errorHandler.js`** — complete. The one behavioral addition is exposing 4xx messages; the body shape **keeps the legacy `{ error: <string>, code? }` contract** that every existing web/mobile client parses (`body.error` is a string), gaining only `reqId`.

```js
'use strict';

const { logger } = require('./logger');

/**
 * Central error middleware — the only try/catch in the request path.
 * A thrown HttpError(4xx) surfaces its message and optional code in the same
 * `{ error, code? }` body shape the routes have always returned; anything else
 * is a masked 500. Never leaks a stack to the client. Register as the final
 * app.use().
 */
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  logger[status >= 500 ? 'error' : 'warn']('request_failed', {
    reqId: req.id,
    method: req.method,
    path: req.path,
    status,
    userId: req.auth?.userId ?? null,
    error: err.message,
    ...(status >= 500 ? { stack: err.stack } : {}),
  });
  if (res.headersSent) return next(err);
  if (err.expose) {
    return res.status(status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      reqId: req.id,
    });
  }
  return res.status(status).json({ error: 'Internal server error', reqId: req.id });
}

module.exports = { errorHandler };
```

**New file: `server/src/services/reportPolicy.js`** — the ingest rulebook, extracted and testable. (Target layout: `domains/reports/policy.js`; placed under `services/` so it lands in the current tree today.)

```js
'use strict';

/*
 * Report-ingest policy: everything that decides WHAT may be stored and how a
 * report is attributed, separated from HOW it is stored (reportStore) and how
 * it arrives (routes). Every rule is a guard clause; the first failure throws
 * an HttpError that the central handler turns into the right 4xx.
 */

const { collection } = require('../db/mongo');
const { HttpError } = require('../lib/http');
const { logger } = require('../lib/logger');

/**
 * Identity is derived from the authenticated principal, never trusted from the
 * body. The one exception is the gov/admin token: trusted tooling may set
 * attribution explicitly (admin edits, tests, backfills).
 */
function applyIdentity(r, auth) {
  if (auth.kind === 'gov') return r;

  const { user_id, reported_for_user_id, ...safe } = r; // strip client-supplied identity
  if (safe.user_type === 'web') {
    // Proxy report by a logged-in family member about someone ELSE — the
    // affected person is resolved later; the submitter only names themselves.
    return { ...safe, reporter_name: auth.user?.name || safe.reporter_name || null };
  }
  // Self report: attributed to the bearer of the token.
  return { ...safe, user_id: auth.userId, reported_by: 'self', reporter_name: null };
}

/** Only the affected person may declare themselves safe, and only via mobile. */
function assertProxyStatusAllowed(r) {
  if (r.status !== 'safe') return;
  throw new HttpError(422,
    'Web proxy reports cannot use status "safe". The affected person must confirm their own safety via the mobile app.');
}

/** Latest location from the person's own (non-web) reports. */
async function latestNonWebLocation(filter) {
  const rows = await collection('reports')
    .find({ ...filter, user_type: { $ne: 'web' } })
    .project({ lat: 1, lng: 1 })
    .sort({ updated_at: -1 })
    .limit(1)
    .toArray();
  return rows.length ? { lat: rows[0].lat, lng: rows[0].lng } : null;
}

/** Proxy reports carry no browser GPS: person's last fix, else the disaster centre. */
async function resolveProxyLocation(r) {
  if (r.personal_id) {
    const loc = await latestNonWebLocation({ personal_id: r.personal_id });
    if (loc) return loc;
  }
  if (r.phone) {
    const loc = await latestNonWebLocation({ phone: r.phone });
    if (loc) return loc;
  }
  if (r.disaster_id) {
    const d = await collection('disasters').findOne({ _id: r.disaster_id }, { projection: { lat: 1, lng: 1 } });
    if (d) return { lat: d.lat, lng: d.lng };
  }
  return null;
}

/** Link the report to the affected person's account: HKID first, then phone. */
async function resolveReportedForUser(r) {
  if (r.reported_for_user_id) return r.reported_for_user_id;
  if (r.personal_id) {
    const u = await collection('users').findOne({ personal_id: r.personal_id }, { projection: { _id: 1 } });
    if (u) return u._id;
  }
  if (r.phone) {
    const u = await collection('users').findOne({ phone: r.phone }, { projection: { _id: 1 } });
    if (u) return u._id;
  }
  return null;
}

/** The web-proxy rulebook: status gate, family attribution, resolved location. */
async function applyProxyRules(r) {
  assertProxyStatusAllowed(r);
  r = { ...r, reported_by: 'family', reported_for_user_id: await resolveReportedForUser(r) };
  if (r.lat != null && r.lng != null) return r;

  const loc = await resolveProxyLocation(r);
  if (!loc) {
    throw new HttpError(422,
      'No known location for the affected person yet — they need to share their status from the mobile app, or include a disaster_id.');
  }
  return { ...r, lat: loc.lat, lng: loc.lng };
}

/** Never lose a report: an unknown disaster_id stores the report unlinked, not rejected. */
async function ensureKnownDisaster(r) {
  if (!r.disaster_id) return r;
  const known = await collection('disasters').findOne({ _id: r.disaster_id }, { projection: { _id: 1 } });
  if (known) return r;
  logger.warn('report_unknown_disaster_unlinked', { disaster_id: r.disaster_id });
  return { ...r, disaster_id: null };
}

/**
 * Validate + enrich a parsed report into its storable form.
 * Throws HttpError(4xx) when the report is not acceptable.
 */
async function prepareForStorage(parsed, auth) {
  let r = applyIdentity(parsed, auth);

  if (r.user_type === 'web') {
    r = await applyProxyRules(r);
  } else if (r.lat == null || r.lng == null) {
    throw new HttpError(400, 'lat and lng are required.');
  }
  return ensureKnownDisaster(r);
}

module.exports = { prepareForStorage };
```

**Rewritten file: `server/src/routes/reports.js`** — complete.

```js
'use strict';

const express = require('express');
const { ReportSchema, RescueQuerySchema, ReportSearchQuerySchema } = require('../lib/zodSchemas');
const { authGuard, authenticate } = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');
const { validate, asyncHandler } = require('../lib/http');
const reportStore = require('../services/reportStore');
const reportPolicy = require('../services/reportPolicy');
const realtimeService = require('../services/realtimeService');

/**
 * /api/reports — report ingest + the read views built on reports.
 * Handlers parse, authorize and delegate; the ingest rulebook lives in
 * services/reportPolicy, storage in services/reportStore.
 * @param {import('socket.io').Server} io Socket.IO instance for live broadcasts.
 * @returns {import('express').Router}
 */
module.exports = function createReportsRouter(io) {
  const router = express.Router();

  // Ingest limiter: separate from the global /api limiter and keyed by USER
  // (post-auth), not raw IP — carrier-NAT users sharing an egress IP must not
  // throttle each other during a real surge.
  const ingestLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: Number(process.env.REPORT_RATE_LIMIT_PER_MIN) || 600,
    keyFn: (req) => req.auth?.userId || `gov:${req.ip}`,
    message: 'Report ingest rate limit reached — your queued reports will retry automatically.',
  });

  // POST /api/reports — submit (or idempotently relay) a status report.
  // Identity is derived from the principal, never trusted from the body.
  router.post('/', authenticate, ingestLimiter, validate(ReportSchema),
    asyncHandler(async (req, res) => {
      const r = await reportPolicy.prepareForStorage(req.valid, req.auth);
      const { id } = await reportStore.upsertReport(r);

      // Web proxy reports never move official stats or trigger broadcasts.
      if (r.user_type !== 'web') await realtimeService.broadcastStats(io);

      res.status(201).json({ ok: true, data: { id } });
    }));

  // GET /api/reports/search?q=&limit=&offset= — public name/phone search
  // (coarse location + masked phone only).
  router.get('/search', validate(ReportSearchQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { q, limit, offset } = req.valid;
      const data = await reportStore.searchByName(q, { limit, offset });
      res.json({ ok: true, data, meta: { limit, offset } });
    }));

  // GET /api/reports/people?limit=&offset=&status= — public Status Overview
  // roster; optional `status` filters to one bucket.
  router.get('/people', asyncHandler(async (req, res) => {
    const { limit, offset } = req.query;
    const status = req.query.status || undefined;
    const { rows, total } = await reportStore.listPeople({ limit, offset, status });
    res.json({ ok: true, data: rows, meta: { limit, offset, total, status } });
  }));

  // GET /api/reports/rescue?lat=&lng=&radius= — privileged triage view.
  router.get('/rescue', authGuard, validate(RescueQuerySchema, 'query'),
    asyncHandler(async (req, res) => {
      const { lat, lng, radius, limit, offset } = req.valid;
      const data = await reportStore.getRescueView(lat, lng, radius, { limit, offset });
      res.json({ ok: true, data, meta: { limit, offset } });
    }));

  // GET /api/reports/stats — official counts exclude web (proxy) reporters by
  // default so this REST path agrees with the socket stats_update broadcast.
  router.get('/stats', asyncHandler(async (req, res) => {
    const excludeWeb = req.query.exclude_web !== 'false';
    res.json({ ok: true, data: await reportStore.getStats({ excludeWeb }) });
  }));

  return router;
};
```

**What this demonstrates.** The 81-line POST handler is now 7 lines and reads as the feature's contract. Every error state is an immediate guard (`assertProxyStatusAllowed`, the 422/400 throws) — zero nesting survives. Each policy rule is one named, independently unit-testable function; `r` is never mutated in place (each step returns a new object). The three data-access helpers stopped squatting in the route module. The try/catch + `console.*` ceremony is gone — failures reach the central handler *with* reqId correlation. Behavior is identical: same status codes, same success bodies, same error strings; the only additive change is `reqId` on error bodies and `logger.warn` replacing `console.warn` for the unknown-disaster case.

## 4.3 Refactoring example 2 — `routes/users.js` (hotspot S1 + S3)

### Before — the targeted handler, complete and verbatim (`server/src/routes/users.js:432-537`)

```js
  // GET /api/users/:id/links — list this user's loved-one links (confirmed +
  // pending) with the partner's latest report status. `is_incoming` marks a
  // pending request this user can confirm. A pending partner's status is withheld
  // until BOTH sides consent (the link is confirmed) — privacy before acceptance.
  router.get('/:id/links', authenticate, async (req, res) => {
    if (!isOwnerOrGov(req, req.params.id)) return forbidden(res);
    const me = req.params.id;
    try {
      const links = await collection('account_links')
        .find({ $or: [{ user_a_id: me }, { user_b_id: me }], status: { $in: ['pending', 'confirmed'] } })
        .toArray();
      if (links.length === 0) return res.json({ ok: true, data: [] });

      const activeDisasters = await collection('disasters')
        .find({ active: true })
        .project({ _id: 1, lat: 1, lng: 1, radius_km: 1 })
        .toArray();

      // Live radius check (recomputed every request) rather than trusting the
      // disaster_id stamped on the report at creation time — a moved/resized
      // zone, or a disaster that started after the report was filed, still
      // shows up correctly here.
      function inAnyActiveZone(lat, lng) {
        if (lat == null || lng == null) return false;
        return activeDisasters.some((d) => isWithinRadius({ lat, lng }, { lat: d.lat, lng: d.lng }, d.radius_km));
      }

      const withPartner = links.map((al) => ({
        al,
        partnerId: al.user_a_id === me ? al.user_b_id : al.user_a_id,
        isIncoming: al.user_b_id === me,
      }));
      const partnerIds = [...new Set(withPartner.map((x) => x.partnerId))];
      const partners = await collection('users')
        .find({ _id: { $in: partnerIds } })
        .project({ _id: 1, phone: 1, name: 1, personal_id: 1 })
        .toArray();
      const partnerById = new Map(partners.map((u) => [u._id, u]));

      // Latest report for a partner, matched by IDENTITY (id / reported-for /
      // HKID / phone), not by display name. Only resolved for confirmed links.
      const latestReportFor = async (u) => {
        const or = [{ user_id: u._id }, { reported_for_user_id: u._id }];
        if (u.personal_id) or.push({ personal_id: u.personal_id });
        if (u.phone) or.push({ phone: u.phone });
        const docs = await collection('reports')
          .find({ $or: or })
          .project({ status: 1, updated_at: 1, disaster_id: 1, lat: 1, lng: 1 })
          .sort({ updated_at: -1 })
          .limit(1)
          .toArray();
        return docs[0] || null;
      }

      // Resolve every confirmed partner's latest report CONCURRENTLY (was a serial
      // await-in-loop N+1). Keyed by partnerId; per-row values are unchanged because
      // latestReportFor depends only on the partner, and the rows below are still
      // built in the original withPartner order — so output and ordering are identical.
      const reportByPartner = new Map(
        await Promise.all(
          withPartner
            .filter(({ al, partnerId }) => al.status === 'confirmed' && partnerById.has(partnerId))
            .map(async ({ partnerId }) => [partnerId, await latestReportFor(partnerById.get(partnerId))])
        )
      );

      const entries = [];
      for (const { al, partnerId, isIncoming } of withPartner) {
        const u = partnerById.get(partnerId);
        if (!u) continue; // JOIN users — drop a link whose partner vanished
        let report_status = null, status_updated_at = null, disaster_id = null, in_affected_zone = false;
        if (al.status === 'confirmed') {
          const r = reportByPartner.get(partnerId) || null;
          if (r) {
            report_status = r.status ?? null;
            status_updated_at = r.updated_at != null ? Number(r.updated_at) : null;
            disaster_id = r.disaster_id ?? null;
            in_affected_zone = inAnyActiveZone(r.lat, r.lng);
          }
        }
        entries.push({
          row: {
            link_id: al._id,
            link_status: al.status,
            confirmed_at: al.confirmed_at ?? null,
            is_incoming: isIncoming,
            user_id: u._id,
            phone: u.phone,
            name: u.name,
            report_status,
            status_updated_at,
            disaster_id,
            in_affected_zone,
          },
          status: al.status,
          created_at: al.created_at,
        });
      }

      // ORDER BY al.status ASC, al.created_at DESC.
      entries.sort((a, b) => {
        if (a.status !== b.status) return a.status < b.status ? -1 : 1;
        return (b.created_at || 0) - (a.created_at || 0);
      });
      return res.json({ ok: true, data: entries.map((e) => e.row) });
    } catch (err) {
      console.error('[users GET /:id/links] failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });
```

### After — three complete files

**New file: `server/src/services/linkStore.js`** — all `account_links` persistence + the roster join. (Target layout: `domains/links/store.js`.)

```js
'use strict';

/*
 * Loved-one links: link CRUD plus the roster a user sees on the Family screen —
 * every link touching them, joined to the partner's profile and, for CONFIRMED
 * links only, the partner's latest report. A pending partner's status is
 * withheld until both sides consent — privacy before acceptance.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { isWithinRadius } = require('../lib/geo');
const { mapId, unwrap } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');

/** All pending/confirmed links touching a user. */
function findLinksTouching(userId) {
  return collection('account_links')
    .find({ $or: [{ user_a_id: userId }, { user_b_id: userId }], status: { $in: ['pending', 'confirmed'] } })
    .toArray();
}

/** Minimal partner profiles for the roster join, keyed by id. */
async function loadPartners(ids) {
  const users = await collection('users')
    .find({ _id: { $in: ids } })
    .project({ _id: 1, phone: 1, name: 1, personal_id: 1 })
    .toArray();
  return new Map(users.map((u) => [u._id, u]));
}

/**
 * Active disaster zones, recomputed per request rather than trusting the
 * disaster_id stamped on a report at creation time — a moved/resized zone, or
 * a disaster that started after the report was filed, still shows correctly.
 */
function loadActiveZones() {
  return collection('disasters')
    .find({ active: true })
    .project({ _id: 1, lat: 1, lng: 1, radius_km: 1 })
    .toArray();
}

function inAnyActiveZone(zones, lat, lng) {
  if (lat == null || lng == null) return false;
  return zones.some((z) => isWithinRadius({ lat, lng }, { lat: z.lat, lng: z.lng }, z.radius_km));
}

/**
 * A partner's latest report, matched by identity (user id / reported-for /
 * HKID / phone), never by display name.
 */
async function latestReportFor(u) {
  const or = [{ user_id: u._id }, { reported_for_user_id: u._id }];
  if (u.personal_id) or.push({ personal_id: u.personal_id });
  if (u.phone) or.push({ phone: u.phone });
  const docs = await collection('reports')
    .find({ $or: or })
    .project({ status: 1, updated_at: 1, disaster_id: 1, lat: 1, lng: 1 })
    .sort({ updated_at: -1 })
    .limit(1)
    .toArray();
  return docs[0] || null;
}

/** Latest report per CONFIRMED partner, resolved concurrently (no serial N+1). */
async function loadLatestByPartner(pairs, byId) {
  const confirmed = pairs.filter((p) => p.al.status === 'confirmed' && byId.has(p.partnerId));
  const rows = await Promise.all(
    confirmed.map(async (p) => [p.partnerId, await latestReportFor(byId.get(p.partnerId))])
  );
  return new Map(rows);
}

/** ORDER BY status ASC ('confirmed' before 'pending'), then newest link first. */
function byStatusThenNewest(a, b) {
  if (a.al.status !== b.al.status) return a.al.status < b.al.status ? -1 : 1;
  return (b.al.created_at || 0) - (a.al.created_at || 0);
}

/** One roster row. Report fields stay null unless the link is confirmed. */
function toRow({ al, u, r, isIncoming, zones }) {
  return {
    link_id: al._id,
    link_status: al.status,
    confirmed_at: al.confirmed_at ?? null,
    is_incoming: isIncoming,
    user_id: u._id,
    phone: u.phone,
    name: u.name,
    report_status: r ? (r.status ?? null) : null,
    status_updated_at: r && r.updated_at != null ? Number(r.updated_at) : null,
    disaster_id: r ? (r.disaster_id ?? null) : null,
    in_affected_zone: r ? inAnyActiveZone(zones, r.lat, r.lng) : false,
  };
}

/**
 * The Family-screen roster for one user.
 * Pipeline: links → (zones ∥ partners) → confirmed partners' latest reports → rows.
 */
async function getRoster(userId) {
  const links = await findLinksTouching(userId);
  if (links.length === 0) return [];

  const pairs = links.map((al) => ({
    al,
    partnerId: al.user_a_id === userId ? al.user_b_id : al.user_a_id,
    isIncoming: al.user_b_id === userId,
  }));

  const [zones, byId] = await Promise.all([
    loadActiveZones(),
    loadPartners([...new Set(pairs.map((p) => p.partnerId))]),
  ]);
  const latest = await loadLatestByPartner(pairs, byId);

  return pairs
    .filter((p) => byId.has(p.partnerId)) // drop a link whose partner vanished
    .sort(byStatusThenNewest)
    .map((p) => toRow({
      al: p.al,
      u: byId.get(p.partnerId),
      r: p.al.status === 'confirmed' ? latest.get(p.partnerId) || null : null,
      isIncoming: p.isIncoming,
      zones,
    }));
}

/** Request a link to another user by phone. Upsert on (requester, target). */
async function requestLink(userId, targetPhone) {
  const target = await collection('users').findOne({ phone: targetPhone }, { projection: { _id: 1 } });
  if (!target) throw new HttpError(404, 'Target user not found');
  if (target._id === userId) throw new HttpError(400, 'Cannot link to yourself');

  const res = await collection('account_links').findOneAndUpdate(
    { user_a_id: userId, user_b_id: target._id },
    {
      $set: { status: 'pending', created_at: Date.now() },
      $setOnInsert: { _id: crypto.randomUUID(), confirmed_at: null },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return mapId(unwrap(res));
}

/** Confirm a pending link — only the recipient (user_b) may accept. */
async function confirmLink(userId, linkId) {
  const res = await collection('account_links').findOneAndUpdate(
    { _id: linkId, user_b_id: userId, status: 'pending' },
    { $set: { status: 'confirmed', confirmed_at: Date.now() } },
    { returnDocument: 'after' }
  );
  const al = unwrap(res);
  if (!al) throw new HttpError(404, 'Pending link not found');
  return mapId(al);
}

/** Remove a link — either side may remove; removing a non-existent link is a no-op. */
async function removeLink(userId, linkId) {
  await collection('account_links').deleteOne({
    _id: linkId,
    $or: [{ user_a_id: userId }, { user_b_id: userId }],
  });
}

module.exports = { getRoster, requestLink, confirmLink, removeLink };
```

**New file: `server/src/services/userStore.js`** — all `users` persistence for the citizen routes: token issuance writes, dup-key mapping, PII masking. (Target layout: `domains/users/store.js`.)

```js
'use strict';

/*
 * Citizen-account persistence: registration upsert, login/refresh token
 * writes (with rotation + reuse detection), profile reads and updates.
 * All PII masking and secret-stripping happens HERE — a raw user doc never
 * crosses this module's boundary.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { generateTokenPair, hashToken } = require('../lib/authGuard');
const { mapId, unwrap } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');

const DUP_PERSONAL_ID = 'This personal ID is already registered to another phone number.';

/** An HKID must never travel back out in full: "A1234567" → "A•••••(7)". */
function maskPersonalId(pid) {
  if (!pid) return null;
  return `${pid[0]}${'•'.repeat(Math.max(0, pid.length - 2))}(${pid[pid.length - 1]})`;
}

/** Public user shape: _id → id, strip secret hashes, mask the HKID. */
function publicUser(doc) {
  if (!doc) return doc;
  const { _id, access_token_hash, refresh_token_hash, password_hash, name_lower, ...rest } = doc;
  return { id: _id, ...rest, personal_id: maskPersonalId(rest.personal_id) };
}

/** Map a Mongo duplicate-key error (personal_id unique index) to a 409. */
function rethrowDup(err) {
  if (err && err.code === 11000) throw new HttpError(409, DUP_PERSONAL_ID);
  throw err;
}

/** The $set fields written whenever a fresh token pair is issued. */
function tokenSet(tok, now) {
  return {
    access_token_hash:        tok.accessTokenHash,
    access_token_expires_at:  tok.accessTokenExpiresAt,
    refresh_token_hash:       tok.refreshTokenHash,
    refresh_token_expires_at: tok.refreshTokenExpiresAt,
    updated_at:               now,
  };
}

/**
 * Create-or-update by phone. Provided fields overwrite, absent ones keep prior;
 * user_type/role/created_at are insert-only. Returns the public user + the
 * one-time plaintext token pair.
 */
async function register({ phone, name, gender, email, personal_id, user_type, privacy_consent }) {
  const now = Date.now();
  const tok = generateTokenPair(now);
  const insertOnly = { _id: crypto.randomUUID(), phone, user_type, role: 'citizen', created_at: now };
  const set = { name, gender, personal_id, privacy_consent, ...tokenSet(tok, now) };
  if (email != null) set.email = email; else insertOnly.email = null;

  let res;
  try {
    res = await collection('users').findOneAndUpdate(
      { phone },
      { $setOnInsert: insertOnly, $set: set },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    rethrowDup(err);
  }
  return { user: publicUser(unwrap(res)), tok };
}

/** Phone-only login for an existing account; issues a fresh token pair. */
async function login(phone) {
  const u = await collection('users').findOne(
    { phone },
    { projection: { phone: 1, name: 1, gender: 1, email: 1, personal_id: 1, user_type: 1, role: 1, privacy_consent: 1 } }
  );
  if (!u) throw new HttpError(404, 'No account found for that number. Please register first.');

  const now = Date.now();
  const tok = generateTokenPair(now);
  await collection('users').updateOne({ _id: u._id }, { $set: tokenSet(tok, now) });
  return { user: { ...mapId(u), personal_id: maskPersonalId(u.personal_id) }, tok };
}

/**
 * Exchange a refresh token for a new pair. Refresh tokens rotate (one-time
 * use) with reuse detection: the immediately-previous hash is kept as a
 * tripwire — presenting it again means the token was stolen and replayed, so
 * the whole family is invalidated and every session must sign in again.
 */
async function rotateRefreshToken(refreshToken) {
  const users = collection('users');
  const presented = hashToken(refreshToken);

  const found = await users.findOne(
    { refresh_token_hash: presented },
    { projection: { refresh_token_expires_at: 1 } }
  );
  if (!found) {
    const reused = await users.findOne({ prev_refresh_token_hash: presented }, { projection: { _id: 1 } });
    if (!reused) throw new HttpError(401, 'Invalid refresh token', 'refresh_invalid');
    await users.updateOne(
      { _id: reused._id },
      { $set: { access_token_hash: null, refresh_token_hash: null, prev_refresh_token_hash: null, updated_at: Date.now() } }
    );
    throw new HttpError(401, 'Refresh token reuse detected — please sign in again.', 'token_reuse');
  }

  const exp = found.refresh_token_expires_at;
  if (exp != null && Number(exp) < Date.now()) {
    throw new HttpError(401, 'Refresh token expired', 'refresh_expired');
  }

  const now = Date.now();
  const tok = generateTokenPair(now);
  await users.updateOne(
    { _id: found._id },
    { $set: { ...tokenSet(tok, now), prev_refresh_token_hash: presented } }
  );
  return tok;
}

/** Profile by phone — HKID returned masked. */
async function profileByPhone(phone) {
  const u = await collection('users').findOne(
    { phone },
    { projection: { phone: 1, name: 1, gender: 1, email: 1, personal_id: 1, user_type: 1, role: 1, privacy_consent: 1, created_at: 1, updated_at: 1 } }
  );
  if (!u) throw new HttpError(404, 'User not found');
  return { ...mapId(u), personal_id: maskPersonalId(u.personal_id) };
}

/** Update own profile — only fields the caller actually provided are written. */
async function updateProfile(id, { name, email, personal_id, privacy_consent }) {
  const set = { updated_at: Date.now() };
  if (name != null) set.name = name;
  if (email != null) set.email = email;
  if (personal_id != null) set.personal_id = personal_id;
  if (privacy_consent != null) set.privacy_consent = privacy_consent;

  let res;
  try {
    res = await collection('users').findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' });
  } catch (err) {
    rethrowDup(err);
  }
  const u = unwrap(res);
  if (!u) throw new HttpError(404, 'User not found');
  return publicUser(u);
}

/**
 * CFR opt-in/out. Opting in is explicit consent to be alerted and to share
 * live location while responding; opting out clears skills so a stale skill
 * can't keep matching.
 */
async function setResponderProfile(id, { responder_opt_in, responder_skills, responder_max_radius_km }) {
  const res = await collection('users').findOneAndUpdate(
    { _id: id },
    {
      $set: {
        responder_opt_in,
        responder_skills: responder_opt_in ? responder_skills : [],
        responder_max_radius_km,
        updated_at: Date.now(),
      },
    },
    { returnDocument: 'after' }
  );
  const u = unwrap(res);
  if (!u) throw new HttpError(404, 'User not found');
  return publicUser(u);
}

module.exports = {
  register,
  login,
  rotateRefreshToken,
  profileByPhone,
  updateProfile,
  setResponderProfile,
  publicUser,
  maskPersonalId,
};
```

**Rewritten file: `server/src/routes/users.js`** — complete. Zero `collection()` calls, zero `try/catch`, zero `console.*`; every handler is guard-clause flat. Middleware order preserves the original semantics exactly (ownership 403 is checked *before* body validation 400, and the link limiter counts requests before the ownership check, as today).

```js
'use strict';

const express = require('express');
const { UserRegisterSchema, UserUpdateSchema, LoginSchema, LinkRequestSchema, ResponderProfileSchema } = require('../lib/zodSchemas');
const { authenticate, isOwnerOrGov, refreshTokenTtlMs } = require('../lib/authGuard');
const { rateLimit } = require('../lib/rateLimit');
const { validate, asyncHandler, HttpError } = require('../lib/http');
const otpService = require('../lib/otpService');
const userStore = require('../services/userStore');
const linkStore = require('../services/linkStore');
const reportStore = require('../services/reportStore');

const REFRESH_COOKIE = 'rs_refresh';
const REFRESH_PATH = '/api/users/token/refresh';

/**
 * The refresh token reaches web clients as an httpOnly cookie so an XSS can't
 * read it from localStorage (the 30-day account-takeover path). It is also
 * still returned in the JSON body for the mobile app, which has no cookie jar.
 * Path-scoped to the refresh endpoint + SameSite=Strict covers CSRF for it.
 */
function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: REFRESH_PATH,
    maxAge: refreshTokenTtlMs(),
  });
}

/** Read a cookie value from the raw header (no cookie-parser dependency). */
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The token fields every token-issuing response returns. */
function tokenBody(tok) {
  return {
    access_token:  tok.accessToken,
    refresh_token: tok.refreshToken,
    expires_at:    tok.accessTokenExpiresAt,
    token_type:    'Bearer',
  };
}

/** After authenticate: only the owner named by :param (or gov) may proceed. */
const own = (param) => (req, res, next) => {
  if (!isOwnerOrGov(req, req.params[param])) {
    return next(new HttpError(403, 'Forbidden — you may only access your own account.'));
  }
  return next();
};

/**
 * If OTP enforcement is on, the request body must carry a valid `otp` for the
 * (already-normalised) phone. No-op when OTP_ENABLED is off — register/login
 * stay frictionless for testing.
 */
async function assertOtp(req, phone) {
  if (!otpService.isEnabled()) return;
  const otp = req.body?.otp;
  if (otp && (await otpService.verifyOtp(phone, String(otp)))) return;
  throw new HttpError(401, 'A valid OTP is required. Request one via POST /api/users/request-otp.', 'otp_required');
}

module.exports = function createUsersRouter() {
  const router = express.Router();

  // Registration + linking are abuse/enumeration vectors → rate-limited.
  const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many registrations from this address.' });
  const linkLimiter     = rateLimit({ windowMs: 60 * 60 * 1000, max: 50, message: 'Link request limit reached (50/hour).' });
  // Token refresh is a credential operation — limit brute-force attempts.
  const refreshLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Too many token refresh attempts.' });
  // OTP requests are an SMS-cost + enumeration vector — limit them.
  const otpLimiter      = rateLimit({ windowMs: 15 * 60 * 1000, max: 5,  message: 'Too many OTP requests — try again later.' });

  // POST /api/users/request-otp — send a one-time passcode to a phone. Always
  // available; only meaningful when OTP_ENABLED=true. In dev the code is echoed
  // back (dev_code) so testers need no real SMS gateway.
  router.post('/request-otp', otpLimiter, validate(LoginSchema), asyncHandler(async (req, res) => {
    const result = await otpService.requestOtp(req.valid.phone);
    res.json({ ok: true, data: { enabled: otpService.isEnabled(), ...result } });
  }));

  // POST /api/users/register — create or update the account for a phone.
  // Tokens are returned once; the client stores both.
  router.post('/register', registerLimiter, validate(UserRegisterSchema), asyncHandler(async (req, res) => {
    await assertOtp(req, req.valid.phone);
    const { user, tok } = await userStore.register(req.valid);
    setRefreshCookie(res, tok.refreshToken); // web reads the cookie; mobile uses the body
    res.status(201).json({ ok: true, user, ...tokenBody(tok) });
  }));

  // POST /api/users/login — phone-only login for an existing account. Citizens
  // have no password in this system; OTP (when enabled) proves phone ownership.
  router.post('/login', registerLimiter, validate(LoginSchema), asyncHandler(async (req, res) => {
    await assertOtp(req, req.valid.phone);
    const { user, tok } = await userStore.login(req.valid.phone);
    setRefreshCookie(res, tok.refreshToken);
    res.json({ ok: true, user, ...tokenBody(tok) });
  }));

  // POST /api/users/token/refresh — exchange a valid refresh token for a new
  // pair. Web sends it via the httpOnly cookie; mobile via the body.
  router.post('/token/refresh', refreshLimiter, asyncHandler(async (req, res) => {
    const presented = readCookie(req, REFRESH_COOKIE) || req.body?.refresh_token;
    if (!presented || typeof presented !== 'string') {
      throw new HttpError(400, 'refresh_token is required');
    }
    const tok = await userStore.rotateRefreshToken(presented);
    setRefreshCookie(res, tok.refreshToken); // rotate the cookie too
    res.json({ ok: true, ...tokenBody(tok) });
  }));

  // GET /api/users/:phone/profile — owner (by phone) or gov. HKID masked.
  router.get('/:phone/profile', authenticate, asyncHandler(async (req, res) => {
    if (req.auth.kind !== 'gov' && req.auth.user.phone !== req.params.phone) {
      throw new HttpError(403, 'Forbidden — you may only access your own account.');
    }
    res.json({ ok: true, data: await userStore.profileByPhone(req.params.phone) });
  }));

  // PATCH /api/users/:id — update own profile (data-correction right).
  router.patch('/:id', authenticate, own('id'), validate(UserUpdateSchema), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await userStore.updateProfile(req.params.id, req.valid) });
  }));

  // DELETE /api/users/:id — PDPO erasure. Deletes the account and scrubs PII
  // from any reports tied to it. The cascade is cross-domain (reports scrub +
  // link/device/safe-place deletes) and stays owned by reportStore until the
  // store split (roadmap step 5) gives it a home of its own.
  router.delete('/:id', authenticate, own('id'), asyncHandler(async (req, res) => {
    const result = await reportStore.eraseUserData(req.params.id);
    if (!result.deleted) throw new HttpError(404, 'User not found');
    res.json({ ok: true, data: result });
  }));

  // PATCH /api/users/:id/responder — CFR opt-in/out + skills + travel radius.
  router.patch('/:id/responder', authenticate, own('id'), validate(ResponderProfileSchema), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await userStore.setResponderProfile(req.params.id, req.valid) });
  }));

  // POST /api/users/:id/links — request to link with another user by phone.
  router.post('/:id/links', authenticate, linkLimiter, own('id'), validate(LinkRequestSchema), asyncHandler(async (req, res) => {
    const data = await linkStore.requestLink(req.params.id, req.valid.target_phone);
    res.status(201).json({ ok: true, data });
  }));

  // PUT /api/users/:id/links/:link_id — confirm a pending link.
  router.put('/:id/links/:link_id', authenticate, own('id'), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await linkStore.confirmLink(req.params.id, req.params.link_id) });
  }));

  // GET /api/users/:id/links — the loved-one roster (partner status only after
  // both sides consent).
  router.get('/:id/links', authenticate, own('id'), asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await linkStore.getRoster(req.params.id) });
  }));

  // DELETE /api/users/:id/links/:link_id — remove a link.
  router.delete('/:id/links/:link_id', authenticate, own('id'), asyncHandler(async (req, res) => {
    await linkStore.removeLink(req.params.id, req.params.link_id);
    res.json({ ok: true });
  }));

  return router;
};
```

**What this demonstrates.** The 555-line route file became ~170 lines of pure HTTP concern; the 105-line roster closure became a 3-line handler plus eight single-purpose functions, each independently testable (`toRow` and `byStatusThenNewest` are pure; the loaders are one-query stubs for mocking). The four-variable mutable prelude became a declarative row builder; the consent rule lives in exactly one visible place; zones and partners now load concurrently (a latent inefficiency fixed for free). The reuse-detection logic — previously buried in an else-branch — is now the visible spine of `rotateRefreshToken`. Naming follows the codebase idiom (`u`, `r`, `al`, `tok`, `loc`) so the signal-to-noise ratio matches the original's best files. Functional identity is preserved end to end: same middleware order (ownership 403 before validation 400, limiter before ownership), same status codes, same response bodies including field order, same 409 dup-key message, same masked-HKID and secret-stripping behavior; `tests/lovedOneCascade.test.js` and `tests/tokenRefresh.test.js` pass unmodified.

## 4.4 Step-by-step implementation roadmap

Each step is a small PR with a hard verification gate; the system is deployed, so behavior parity is checked continuously. **Gate for every step:** `npm test` (20 files / 159 green — local Mongo up), `npm run lint`, `cd web && npm run build`, `cd mobile && npx tsc --noEmit`.

**Step 0 — Baseline & safety net (½ day).** Run the full gate on a clean checkout and record the output. Commit the untracked-artifacts decision (move `Emergency Operations Dashboard.html` to `design/` or delete; gitignore `.claude/launch.json`).

**Step 1 — Zero-risk removals (½ day).** Delete: `firebase` dep + `firebaseConfig.ts`; `expo-font`; root `domexception`, `web-streams-polyfill`, the three babel plugins, `@expo/ngrok`, `@types/react`; `StatCard.vue` + its import; `api.js#triggerDisaster`; the dead mobile apiClient exports. Move root `vite` and mobile `vitest` to devDependencies; drop mobile `vite`. Decide the Expo-Web target (recommend removing `react-dom`/`react-native-web`/`@expo/metro-runtime` + `userStorage.web.ts` + the `web` script together). Fix DEPLOYMENT.md's Node version (or merge it into DEPLOYMENT_AZURE.md) and bump CI to Node 22. Delete or README-document the four orphaned scripts. *Gate + one manual smoke of mobile registration/report + a deploy-zip build.*

**Step 2 — The HTTP kernel (1 day).** Add `lib/http.js`; extend `errorHandler` with the exposable-4xx behavior (both complete in §4.2 — note the error body deliberately keeps the legacy `{ error: string, code? }` contract). Convert the reports router end-to-end as the template — §4.2 verbatim, including `reportPolicy.js`. Add ESLint `no-console` for `server/src/{routes,services,lib}` with the existing `db/` carve-out (as warning first). *Gate; diff the reports suite's HTTP responses before/after.*

**Step 3 — Sweep the route layer (2–3 days, mechanical).** Convert the remaining routers to `validate`/`asyncHandler`/`HttpError` — the users router lands as §4.3 verbatim (routes + `userStore` + `linkStore`) — replacing every `console.*` with `logger` events as each file is touched. Give admin routes real Zod schemas (start from the inline checks; add `pickProvided` to kill the three COALESCE ladders). Escalate `no-console` to error. *Gate after each router — the suites are per-domain, so breakage localizes.*

**Step 4 — One implementation per concept (2 days).** (a) `resolvePrincipal` + `requireRole` replacing the four auth middlewares (keep exported names as thin aliases first; delete after call-sites migrate). (b) `realtime/hub.js` with `emitGlobal`/`emitToUsers`/`emitInRadius`; rewrite the four broadcast loops onto it. (c) `geo.findWithinRadius(collectionName, opts)` absorbing the five copy-pasted radius loops, preserving each site's projection/cap/sort. *Gate + `tests/auth.test.js`, `tests/devicesAuth.test.js`, `tests/triggerEngine.test.js`, `tests/incidentRoutes.test.js` scrutiny.*

**Step 5 — Stores for the orphan domains (3–4 days, one domain per PR).** Extract `shelterStore`, `safePlaceStore`, `incidentStore`, `missingPersonStore`, `deviceStore` (users and links already landed in step 3). Split `zodSchemas.js` per domain at the same time. When every domain has a store, `reportStore.js` sheds its squatters (user search stays — it is genuinely a reports/users view — but shelters move to `shelterStore` and the erasure cascade becomes `userStore.eraseUser`, orchestrating the other stores). Optionally finish with the `domains/` folder move — pure `git mv` + require-path updates, zero logic. *Gate per domain.*

**Step 6 — Client decomposition (3–4 days, independent of 2–5).** Web: `LoginPanel.vue` + `DataTable.vue` (AdminView + GovView consume them); `useLiveQuery` composable (delete FamilyView's timer and StatusView's socket-race patch); split GovView (extract `lib/radar.js` first — pure math, trivial test); AdminView `TAB_CONFIG` map replacing the `loadTab` ladder; collapse `api.js` onto one `request()` core. Mobile: split `DisasterModeContext` into the three providers; split `AccountScreen`; extract `validateReportForm`; gate mesh Layer 2 behind `MESH_ENABLED=false` default. *Gate + web build + manual pass of /gov, /admin, and the mobile disaster-gate flow (QA_TEST_PLAN.md has the scripts).*

**Step 7 — Shared vocabulary + guardrail enforcement (1–2 days).** Create `shared/` (statuses/priorities/colors, hkid, phone, severity, common i18n keys) consumed by server+web (+mobile if Metro `watchFolders` cooperates; otherwise add the CI drift-check script). Add the §4.1 guardrails to CLAUDE.md §7 and wire the lint rules that enforce #2 (`no-restricted-imports`: `db/mongo` disallowed from `routes/`), #4 (`no-console`), plus comment-hygiene guidance: when touching a file, keep invariant comments, drop ticket codes and SQL-era comparisons.

**Total: ~2.5 developer-weeks**, no step longer than a day-or-so of uninterrupted work, every step shippable and individually revertible, feature parity enforced by the existing 159-test suite plus the manual QA scripts.

### Acceptance checklist for "done"

- [ ] `npm test` 20 files / 159 tests green; lint clean including `no-console`
- [ ] Zero `collection()` calls under `server/src/routes/`
- [ ] Zero `console.*` under `server/src/{routes,services,lib}`
- [ ] Zero `safeParse` outside `lib/http.js`; admin inputs Zod-validated
- [ ] One auth middleware family, one broadcast hub, one radius-query helper
- [ ] No file > 500 lines in `web/src/views` or `mobile/src` (GovView split, AccountScreen split, DisasterModeContext split)
- [ ] `npm ls firebase expo-font domexception web-streams-polyfill @expo/ngrok` → empty
- [ ] CLAUDE.md guardrails 1–8 verifiably intact (free-tier throughput, trust proxy, fail-closed limiter, web proxy-only, PII mappers, PDPO cascade, graceful degradation, registration contract)

---

## Appendix A — Full endpoint matrix (all 66, one row each)

| # | Method & path | Auth | Zod | Emits |
|---|---|---|---|---|
| 1 | `GET /api/live` | — | — | — |
| 2 | `GET /api/ready` | — | — | — |
| 3 | `GET /api/metrics` | — | — | — |
| 4 | `GET /api/health` (legacy) | — | — | — |
| 5 | `POST /api/reports` | authenticate + ingest limiter | ReportSchema | stats_update (non-web) |
| 6 | `GET /api/reports/search` | — | ReportSearchQuerySchema | — |
| 7 | `GET /api/reports/people` | — | inline | — |
| 8 | `GET /api/reports/rescue` | gov | RescueQuerySchema | — |
| 9 | `GET /api/reports/stats` | — | inline | — |
| 10 | `GET /api/disasters` | — | — | — |
| 11 | `POST /api/disasters/trigger` | gov | ManualDisasterSchema | disaster_alert, loved_one_alert |
| 12 | `POST /api/disasters/:id/deactivate` | gov | — | disaster_deactivated |
| 13 | `GET /api/shelters` | — | ShelterQuerySchema | — |
| 14 | `GET /api/shelters/:id` | — | — | — |
| 15 | `POST /api/shelters` | gov/volunteer | ShelterCreateSchema | — |
| 16 | `PUT /api/shelters/:id` | gov/volunteer | ShelterUpdateSchema | — |
| 17 | `DELETE /api/shelters/:id` (soft) | gov/volunteer | — | — |
| 18 | `POST /api/users/request-otp` | — (5/15 min) | LoginSchema | — |
| 19 | `POST /api/users/register` | — (10/hr) | UserRegisterSchema | — |
| 20 | `POST /api/users/login` | — (10/hr) | LoginSchema | — |
| 21 | `POST /api/users/token/refresh` | — (30/15 min) | inline | — |
| 22 | `GET /api/users/:phone/profile` | owner-or-gov | — | — |
| 23 | `PATCH /api/users/:id` | owner-or-gov | UserUpdateSchema | — |
| 24 | `DELETE /api/users/:id` (PDPO erasure) | owner-or-gov | — | — |
| 25 | `PATCH /api/users/:id/responder` | owner-or-gov | ResponderProfileSchema | — |
| 26 | `POST /api/users/:id/links` | owner-or-gov (50/hr) | LinkRequestSchema | — |
| 27 | `PUT /api/users/:id/links/:link_id` | owner-or-gov | — | — |
| 28 | `GET /api/users/:id/links` | owner-or-gov | — | — |
| 29 | `DELETE /api/users/:id/links/:link_id` | owner-or-gov | — | — |
| 30 | `POST /api/safe-places` | authenticate | SafePlaceCreateSchema | — |
| 31 | `GET /api/safe-places` | — | SafePlaceQuerySchema | — |
| 32 | `GET /api/safe-places/pending` | gov/volunteer | — | — |
| 33 | `PUT /api/safe-places/:id/status` | gov/volunteer | inline | — |
| 34 | `POST /api/devices/register` | optional bearer (60/min) | DeviceRegisterSchema | — |
| 35 | `DELETE /api/devices/:token` | owner-or-gov | — | — |
| 36 | `POST /api/incidents` | gov | IncidentCreateSchema | incident_alert |
| 37 | `GET /api/incidents/active` | gov | — | — |
| 38 | `GET /api/incidents/nearby` | authenticate | inline | — |
| 39 | `GET /api/incidents/:id` | authenticate | — | — |
| 40 | `POST /api/incidents/:id/respond` | authenticate | IncidentRespondSchema | incident_update |
| 41 | `POST /api/incidents/:id/resolve` | gov | inline | incident_resolved |
| 42 | `GET /api/aed` | — | AedQuerySchema | — |
| 43 | `POST /api/missing-persons` | gov/volunteer | MissingPersonCreateSchema | missing_alert |
| 44 | `GET /api/missing-persons` | gov/volunteer | inline | — |
| 45 | `PUT /api/missing-persons/:id` | gov/volunteer | MissingPersonUpdateSchema | — |
| 46 | `DELETE /api/missing-persons/:id` (soft close) | gov/volunteer | — | — |
| 47 | `POST /api/admin/login` | — (10/15 min) | inline | — |
| 48 | `GET /api/admin/stats` | super_admin | inline | — |
| 49 | `GET /api/admin/audit` | super_admin | inline | — |
| 50 | `GET /api/admin/users` | super_admin | inline | — |
| 51 | `POST /api/admin/users` | super_admin | inline | — |
| 52 | `PUT /api/admin/users/:id` | super_admin | inline | — |
| 53 | `DELETE /api/admin/users/:id` | super_admin | inline | — |
| 54 | `GET /api/admin/reports` | super_admin | inline | — |
| 55 | `POST /api/admin/reports` | super_admin | inline | — |
| 56 | `PUT /api/admin/reports/:id` | super_admin | inline | — |
| 57 | `DELETE /api/admin/reports/:id` | super_admin | inline | — |
| 58 | `GET /api/admin/disasters` | super_admin | inline | — |
| 59 | `POST /api/admin/disasters` | super_admin | inline | — |
| 60 | `PUT /api/admin/disasters/:id` | super_admin | inline | — |
| 61 | `DELETE /api/admin/disasters/:id` | super_admin | inline | — |
| 62 | `GET /api/admin/links` | super_admin | inline | — |
| 63 | `PUT /api/admin/links/:id` | super_admin | inline | — |
| 64 | `DELETE /api/admin/links/:id` | super_admin | inline | — |
| 65 | `GET /api/admin/devices` | super_admin | inline | — |
| 66 | `DELETE /api/admin/devices/:id` | super_admin | inline | — |

## Appendix B — Flagged-item quick reference

**Delete:** `firebase` + `firebaseConfig.ts` · `expo-font` · root `domexception`, `web-streams-polyfill`, the three `@babel/plugin-transform-*` plugins, `@expo/ngrok`, `@types/react` · `StatCard.vue` · `api.js#triggerDisaster` · apiClient `listSafePlaces`/`getCurrentUser`/`currentUserRole` · (decide) `react-dom`+`react-native-web`+`@expo/metro-runtime`+`userStorage.web.ts`.
**Move:** root `vite`, mobile `vitest` → devDependencies.
**Fix docs/CI:** DEPLOYMENT.md Node 20→22 (or merge into DEPLOYMENT_AZURE.md) · ci.yml Node 20→22.
**Triage:** `inspect-db.cjs`, `scripts/backup-db.ps1`, `scripts/backup-db.sh`, `server/scripts/fillDatabase.js` (document or delete) · `Emergency Operations Dashboard.html` (design/ or delete) · `.claude/launch.json` (gitignore).
**Refactor (ranked):** users links handler (S1, §4.3) · reports POST (S2, §4.2) · console→logger sweep · auth×4 → `requireRole` · broadcast×4 → hub · geo loop×5 → `findWithinRadius` · admin Zod + `pickProvided` · GovView split · AdminView `TAB_CONFIG` · DisasterModeContext split · AccountScreen split · api.js `request()` core.
**Do NOT touch:** destructure-to-omit mappers · two-phase erasure · box+haversine double filter · separate ingest limiter · `GEO_SCAN_CAP` · lenient report schema fields · always-false mesh stub semantics · the eight CLAUDE.md guardrails.
