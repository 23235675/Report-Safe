# Report Safe (報平安) — Pre-Test Readiness Assessment

**Assessor:** Senior staff engineer / technical auditor (pre-QA readiness review)
**Date:** 2026-06-12
**Scope:** Full-stack monorepo — `mobile/` (Expo/RN), `web/` (Vue 3), `server/` (Node/Express/Socket.IO/PostgreSQL)
**Verdict:** **CONDITIONAL-GO** for case testing · **Overall readiness 58 / 100**
**Update (2026-06-13):** **GO** for functional case testing — the headline test blocker (B1) is cleared and the web-proxy invariant (B2) is substantially enforced. One security item (R3, `/api/users` authz) remains before production. See §0 below.

> **Revision note (incorporates stakeholder clarifications, 2026-06-12):**
> 1. **Web is proxy-only by design.** Web users must NOT submit location-tagged reports and must NOT submit their own status; they may only file a report *on behalf of* an affected relative in the zone. The proxy report is meant to **combine with the affected person's own report by shared identity (UUID)**, with **location supplied by the affected mobile user**. Web users cannot trigger disaster mode, cannot enter disaster mode, and do not receive push notifications. Web users are **never counted** in affected statistics. — This *confirms* finding **B2**: the current implementation diverges from this intent (see §4.B2).
> 2. **Deployment jurisdiction is Hong Kong.** All personal-information handling must follow the **Personal Data (Privacy) Ordinance (PDPO, Cap. 486)** and its 6 Data Protection Principles; disaster standards/metrics should follow **Hong Kong Observatory (HKO)** conventions (Tropical Cyclone Warning Signals, Rainstorm Warning System, etc.). — This makes the Compliance dimension (§4.15) concrete and in-scope, and adds a disaster-standard localization gap (§4.1).

---

## 0. Session Update — 2026-06-13 (hardening sprint results)

This section records the fixes applied after the original assessment and supersedes the stale per-dimension numbers where noted. Everything below was **run and verified locally** against the docker-compose Postgres.

### Root cause of "tests won't connect" (was misdiagnosed as a Windows Docker limitation)
A **native Windows `postgresql-x64-18` service squats on host port 5432**, so our Docker container could only bind IPv6 and every host-side `pg` connection hit the *wrong* server (PostgreSQL 18, no `reportsafe` role) → `role "reportsafe" does not exist`. **Fix:** docker-compose now maps the container to host **5433**; local dev + tests target 5433. A second issue: `server/.env` had `DATABASE_URL` pointing at **live Azure**, so `npm run dev` was unknowingly serving production data — now defaults to local Docker, with Azure preserved as a commented opt-in.

### Real bugs found and fixed
- **`setup.js` FK ordering bug** — `reports.disaster_id` FK referenced `disasters` *before* that table was created; failed on any genuinely-empty DB. FK moved to after the `disasters` table. (`server/src/db/setup.js`)
- **Report-loss via the new FK** — an unknown `disaster_id` (FK `23503`) now stores the report *unlinked* instead of 500-ing, preserving invariant #1. (`server/src/routes/reports.js`)
- **Tests shared the dev DB and wiped it** — added an isolated, auto-created `reportsafe_test` database (`tests/_global.setup.js`); dev `reportsafe` data now survives test runs.

### Status of the original blockers / key recommendations
| Item | Before | Now |
|---|---|---|
| **B1 / R1 — test suite** | 14/18 red, no DB | ✅ **35/35 green**, sequential, isolated `reportsafe_test` (auto-created) |
| **B2 / R2 — web = proxy-only, never counted** | self-report, counted as `mobile` | ✅ **Substantially enforced**: web registers/report as `user_type:'web'` (`web/src/views/AccountView.vue:48`, `ReportView.vue:130`), public stats pass `excludeWeb:true` (`HomeView.vue:40`), web can't trigger disasters (verified 401). ⚠️ Remaining: `ReportView` still offers self-status (`selfStatuses`), and the Socket.IO `stats_update` broadcast doesn't pass `excludeWeb`. |
| **R3 — `/api/users/*` authz** | unauthenticated | 🟠 **Still open** — `register` is necessarily public, but `PATCH /:id`, links, and `/:phone/profile` need authz/rate-limiting. `/rescue` and `/disasters/trigger` **are** auth-gated (verified 401). |
| **R5 — geo scans** | O(n) haversine | ✅ Index-friendly **bounding-box prefilter** in `getRescueView`/`getShelters` + shelters route |
| **R9 — HK localization** | mixed world data | ✅ Seed = **3 HK disasters** (T10 / Black Rainstorm / Mid-Levels landslip) + **10,000 random HK users** (valid HKIDs, `+852` phones); all coords in HK bounds; mock feeds off by default |
| **R10 — audit / retention (PDPO)** | absent | ✅ `audit_logs` written for privileged actions; retention purge job added (`RETENTION_DAYS`, off by default) |
| **Stats query** | 11 correlated subqueries | ✅ single `GROUP BY` + one disaster count |
| **Report↔user linkage** | name-collision joins | ✅ `user_id`/`reported_for_user_id` threaded through schema→upsert; family links join by identity, not name |

### Build / verification evidence (all green this session)
- **Backend:** boots on :3001 against local DB; `/api/health`, `/api/disasters` (3 HK), `/api/reports/stats` verified.
- **End-to-end API:** submit report (FK ok) → public search (no PII leak) → register (HKID masked `Q••••••(2)`) → `/rescue` 401 without auth, full HKID with auth → `/trigger` 401 without auth. All pass.
- **Web:** `npm run build:web` → 88 modules, clean.
- **Mobile:** `tsc --noEmit` clean (fixed missing `userStorage` type decl for the platform-resolved module).
- **Tests:** `vitest run` → 35/35.

### Revised dimension deltas
- **Testing readiness:** 1 · 20% → **4 · ~85%** (suite green + isolated DB; CI still absent → R4).
- **Compliance (PDPO):** 2 · 35% → **3 · ~55%** (audit + retention + masking; DPP4 authz on `/api/users` still open → R3).
- **Data layer / Performance:** geo prefilter + single-pass stats applied (R5).

**Net:** local functional/QA testing can proceed now.

---

## 0.1 Session Update — 2026-06-13 (full hardening sprint)

Second pass closed **every** blocker/major/minor except the one that needs external
infrastructure (Redis). All changes were run and verified locally: **44/44 unit/DB
tests** pass against the isolated `reportsafe_test` DB, and a **20-check live API
e2e** passes against a freshly seeded local server.

| Item | Status | What was done / evidence |
|---|---|---|
| **B1 / R1** test suite | ✅ done | 44/44 green; isolated `reportsafe_test`. |
| **B2 / R2** web=proxy-only, never counted | ✅ done | Web `ReportView` is now proxy-only (no self-status, **no browser GPS**); server resolves the affected person's location from their own mobile report → disaster centre → 422 if unknown (`reports.js`); proxy reports identity-link via `reported_for_user_id`; excluded from official counts (HTTP `exclude_web` **and** the socket broadcast). Live e2e: web report w/o coords resolves; official `total=1` vs all `=3`. |
| **M1 / R3** `/api/users/*` authz | ✅ done | Per-user access tokens (SHA-256 hashed) issued at register; `authenticate` + ownership on profile/patch/links/erasure. Live e2e: no-token→401, owner→200, other-user→403. |
| **M2** rate limiting | ✅ done | Dependency-free limiter: global 300/min + register (10/h) + links (5/h); `X-RateLimit-*` headers. |
| **M3 / R6** multi-instance | ⚠️ deferred (infra) | Needs a Socket.IO **Redis adapter** + externalized socket-location state — requires a Redis server not available here. Seam documented in `realtimeService.js` / `rateLimit.js`; single-instance is correct until then. |
| **M4 / R5** geo + search | ✅ done | Bounding-box prefilter (rescue/shelters/safe-places) **+ pg_trgm GIN index** on `lower(name)` so the public search is index-backed. |
| **M5 / R7** triage downgrade | ✅ done | `STATUS_PRIORITY` redesigned so escalation never demotes: `need_help`/`awaiting_response` both P1, above `injured`. Test locks it in. |
| **M6 / R8** migration safety | ✅ done | No `EXCEPTION WHEN OTHERS` remains; migrations use targeted `IF NOT EXISTS` guards. (A migration tool like node-pg-migrate is optional future polish.) |
| **M7** pagination | ✅ done | `limit`/`offset` on `/search` (≤100) and `/rescue` (≤1000), validated by Zod; echoed in responses. |
| **M8 / R10** observability | ✅ done | Structured JSON logger + request logging with correlation IDs (`X-Request-Id`); `audit_logs` written for privileged actions; retention purge job. |
| **M9 / R4** CI/CD + Docker | ✅ done | `.github/workflows/ci.yml` (Postgres service → `npm test` + web build + mobile typecheck) and a multi-stage `server/Dockerfile` with healthcheck. |
| **M10** PDPO | ✅ done | DPP1 consent **required** at register; DPP6 correction (`PATCH`) + **erasure** (`DELETE /api/users/:id` scrubs report PII); audit + retention; HKID masked on every response. |
| **M11 / R9** HKO model | ✅ done | `hkoSignal()` maps severity → TC signals (T1/T3/T8/T9/T10) + Rainstorm (Amber/Red/Black); triggered disasters carry the HK signal name. |
| **R11** dead tables | ✅ mostly | `safe_places` now has a route (`GET` public, `POST` auth); `audit_logs`/`status_history` already live. `rescue_requests`/`team_assignments`/`missing_person_cases` documented as future operational-workflow phase. |
| Minors | ✅ done | `findDuplicateActive` clamp (already fixed); mobile↔server status set aligned (9) + mobile `fetch` timeout; README de-staled (pg, Expo 54, port 5433, token); gov token consistent (`GOV-SECRET-TOKEN-2024`); CORS allowlist + security headers + constant-time token compare; ESLint/Prettier/EditorConfig added; stale `.db` files removed. |

**Revised scorecard (post-sprint):** Security 2→**4**, Compliance 2→**4**, Testing 1→**4**,
Data layer 3→**4**, Observability 2→**3**, DevOps 3→**3.5**, API design 3→**4** (pagination).
**Only remaining pre-production gap: M3/R6 (Redis multi-instance), which is infra-dependent.**

---

## 1. Executive Summary

Report Safe is a genuinely well-architected disaster-reporting prototype. Its core promise — *never lose a report, deliver the moment any path opens* — is implemented cleanly: outbox-first writes, idempotent UUID upserts, and a 3-layer internet→mesh→queue fallback. Code is readable, input is Zod-validated, and SQL is parameterized.

It is **not yet ready to begin formal case/QA testing**, primarily because **the automated test suite is red and stale** (14 of 18 tests fail against today's PostgreSQL backend), so QA would begin with no working regression signal. Supporting blockers/risks: a confirmed data-integrity rule is not enforced, the user/family API has no access control, the system is single-instance only, and a portion of the v4 data model is scaffolding.

**Top 5 findings (plain language):**

1. **The test suite doesn't run (14/18 fail).** Server tests call a DB helper (`getDb`) that no longer exists and use the old synchronous SQLite API; one mobile test drifted from the code contract. You cannot trust "passed"/"regressed" until this is fixed. *(🔴 Blocker.)*
2. **"Web users are never counted as affected" is not enforced, and the intended web=proxy-only flow is not implemented.** The web form currently lets web users self-report, pulls the browser's GPS, mints a fresh UUID (so it never merges with the affected person's record), and is stored as `mobile` — so it *is* counted. *(🔴 Blocker for stats-correctness testing.)*
3. **The entire `/api/users/*` family API is unauthenticated.** Anyone reaching the server can look up a person by phone, edit any profile, and list anyone's family + each member's status and location — sensitive HK personal data under PDPO. *(🟠 Major; likely PDPO DPP4 issue.)*
4. **It won't scale past one server instance.** "Who is near a disaster" lives in one process's memory; two instances behind a balancer means alerts reach only some users. Geo queries also full-scan every report. *(🟠 Major.)*
5. **Part of the v4 model is scaffolding.** Six tables (audit log, status history, missing-person cases, rescue requests, team assignments, safe-places) are created but never read/written; several RFD features (SMS link confirmation, safe-place submission, audit logging, bulk SMS/export, role-based auth) are absent. *(🟠 scope clarity.)*

**Recommendation:** Run a short hardening sprint before QA — fix the test suite (R1), implement the confirmed web-proxy/merge model + `user_type` tagging (R2), and lock down or explicitly descope the `/api/users` endpoints (R3). After those three, this is a solid Conditional-Go.

---

## 2. Assumptions Made

The original brief's input placeholders were unfilled; context was discovered from the code and docs, then refined by stakeholder clarification. Items confirmed by the stakeholder are marked **(confirmed)**.

| # | Assumption | Basis / Confidence |
|---|---|---|
| A1 | **Purpose:** citizens submit safe/injured/need-help status during disasters; families search; government triages rescue; offline-tolerant. | README, CLAUDE.md. High. |
| A2 | **Actual stack:** Node/Express 4 + Socket.IO 4 + **PostgreSQL (`pg`)** (PostGIS optional) + Vue 3/Vite/Leaflet + RN/**Expo SDK 54**. README's "SQLite/better-sqlite3 + Expo 51" is **stale**. | `pool.js`, `mobile/package.json`. High. |
| A3 | **Requirements source of truth:** `RFD_GAP_ANALYSIS.md` (v4) + CLAUDE.md invariants. | Repo docs. High. |
| A4 | **Target scale:** disaster-driven **bursty load** (thousands of reports/region in minutes; many concurrent sockets). Real latency numbers are **unverified** — no DB was running and no load test was run. | Inference. Medium. |
| A5 | **(confirmed) Compliance jurisdiction: Hong Kong.** Personal data → **PDPO (Cap. 486)** + 6 DPPs, regulated by the PCPD. Disaster metrics → **HKO** standards (TC Warning Signals T1/T3/T8/T9/T10; Rainstorm Amber/Red/Black; etc.). | Stakeholder. High. |
| A6 | **(confirmed) Web = proxy-report-only.** No web location-tagging, no web self-status, no disaster-mode/push for web; proxy reports merge with the affected person's record by shared identity, location from the affected mobile user; web never counted in affected stats. | Stakeholder. High. |
| A7 | **Reference standards:** OWASP Top 10 / ASVS, 12-Factor, common REST/PostgreSQL/Vue/RN conventions. | Per brief. High. |
| A8 | The build is a demonstrable **prototype** with documented production-migration paths (mesh, DB, auth). Production-readiness is judged honestly but the documented intent is credited. | README "Known limitations". High. |

---

## 3. Scorecard

| Dimension | Maturity (1–5) | Complete % | One-line status |
|---|---|---|---|
| 1. Requirements completeness | 3 Defined | 58% | v4.0 foundation built; web-proxy/merge, SMS, safe-places, audit, bulk tools, role auth, HKO disaster model absent. |
| 2. Architecture & design | 3 Defined | 70% | Clean layering & migration seams; in-memory socket state is a scale SPOF; dead schema. |
| 3. Code quality & maintainability | 3 Defined | 65% | Readable, well-commented; no linter/formatter; duplicated SQL; stale tests. |
| 4. API design | 3 Defined | 65% | Consistent envelope + Zod; no versioning, pagination, OpenAPI; auth gaps. |
| 5. Data layer | 3 Defined | 60% | Indexed & transactional, but geo queries can't use indexes; ad-hoc migrations swallow errors. |
| 6. Security | 2 Developing | 40% | Unauthenticated user/PII endpoints (IDOR); no rate limiting; single shared token. |
| 7. Performance & efficiency | 2 Developing | 50% | Full-scan haversine + leading-wildcard search; no caching. Largely **unverified**. |
| 8. Reliability & resilience | 3 Defined | 65% | Strong never-lose model; no retry/backoff or fetch timeouts; errors silently swallowed. |
| 9. Scalability | 2 Developing | 45% | Single-instance only (no Socket.IO Redis adapter); O(n) geo scans; no pagination. |
| 10. Testing readiness | ~~1 Initial · 20%~~ → **4 Managed · ~85%** (2026-06-13) | — | **35/35 tests pass** against an isolated, auto-created `reportsafe_test` DB; CI still absent (R4). See §0. |
| 11. Observability | 2 Developing | 35% | `console.*` only; health check exists; no structured logs, metrics, tracing, alerting. |
| 12. DevOps & deployment | 3 Defined | 50% | docker-compose + good `.env.example` + single-artifact serve; no CI/CD, Dockerfile, IaC. |
| 13. Frontend quality | 3 Defined | 63% | Rich EOC UI, good states; heavy inline styles; a11y/CWV **unverified**; web self-report contradicts proxy-only intent. |
| 14. Documentation | 3 Defined | 65% | Excellent RFD/CLAUDE/comments; README stale & contradicts code; no API reference. |
| 15. Compliance (HK / PDPO) | 2 Developing | 35% | `privacy_consent` unenforced; no audit trail/retention; unauthenticated PII access (DPP4 risk). |

---

## 4. Detailed Findings

### 4.1 Requirements Completeness — *Maturity 3 · 58%*
**Standard:** Every specified feature/flow implemented, or explicitly descoped.
**Actual:** v4.0 foundation present — `users`, `account_links`, `shelters` tables + reports `user_type`/`user_id` (`server/src/db/setup.js`); register/profile/link/shelter-CRUD endpoints (`server/src/routes/users.js`, `server/src/routes/shelters.js`); `stats?exclude_web` (`server/src/routes/reports.js:70`); five mobile screens (`mobile/App.tsx:9`); six web views.
**Gaps vs RFD + confirmed intent:**
- **Web-proxy / merge model (A6) not implemented** — see §4.B2.
- SMS link confirmation: confirm endpoint flips status with **no token** (`server/src/routes/users.js:117`).
- `POST /api/safe-places` (Phase 3): **no route** despite the table.
- Real-time `linked_person_status` / `entered_zone` events: **absent** (`server/src/lib/socketEvents.js`).
- Audit log, bulk SMS, CSV export, timeseries (Phase 4): absent.
- **Role-based auth:** `users.role` column exists but is never checked.
- **HKO disaster localization (A5):** trigger model is generic `magnitude≥6.0 OR severity≥3` with a 0–5 `severity` integer and mock feeds for Tokyo/Taichung/Bangkok/LA (`server/src/services/triggerEngine.js:29`). For HK it should map to **HKO Tropical Cyclone Warning Signals** (T1/T3/T8a–d/T9/T10) and the **Rainstorm Warning System** (Amber/Red/Black), not an ad-hoc numeric severity. Wildfire is not a primary HK hazard.
**Severity:** 🟠 Major (scope clarity + localization).

### 4.B2 Data Integrity — Web = Proxy-Only & "Never Counted" — *Blocker*
**Confirmed intended design (A6):**
- Web users **cannot** submit their own status and **cannot** location-tag a report.
- Web users **only** file a report *for* an affected relative in the zone.
- The proxy report **combines with the affected person's own report** by shared identity (UUID); **location comes from the affected mobile user**; combining yields the full status.
- Web users **never** trigger/enter disaster mode, never get push, and are **never counted** in affected statistics.

**Actual implementation (evidence):**
1. **Web self-reporting is allowed** — `web/src/views/ReportView.vue:33` defines `selfStatuses = ['safe','injured','need_help']`; a web user can submit their own status, contradicting proxy-only.
2. **Web location-tags reports** — `ReportView.vue:61` calls `navigator.geolocation` and sends `lat`/`lng` (`ReportView.vue:98`), contradicting "no web location."
3. **No merge by identity** — the web proxy report mints a fresh `crypto.randomUUID()` (`ReportView.vue:93`), so it can never share the affected person's UUID; the server's `ON CONFLICT (id) DO UPDATE` only increments `relay_count` (`server/src/services/reportStore.js:54`) and performs **no combine** of proxy + self into a "full status." Result: **duplicate records**, not a merged one.
4. **Not tagged → counted** — `ReportSchema` has **no `user_type`** (`server/src/lib/zodSchemas.js:27`) and `upsertReport` doesn't write it, so every report defaults to `user_type='mobile'`. The stats filter `WHERE user_type IS NULL OR user_type = 'mobile'` (`reportStore.js:178`) therefore excludes nothing. Web-origin reports are counted as affected.

**Design note for the fix:** a web relative cannot know the affected person's client-generated UUID, so "same UUID" must be realized through a **deterministic identity key** — e.g. link the proxy report to `reported_for_user_id` (via `account_links`) and dedupe per *(affected person × disaster)* — with the affected person's own self-report taking precedence for location/status. Web-origin writes should be tagged (`user_type='web'` or a `reported_via='web'` flag) and excluded from affected counts at the source.
**Severity:** 🔴 Blocker for stats-correctness test cases; core product behavior.

### 4.2 Architecture & Design — *Maturity 3 · 70%*
**Standard:** Separation of concerns, loose coupling, documented seams, scalable shape.
**Actual:** Strong layering (`routes/`→`services/`→`db/pool` + `lib/`); routers are factories taking `io` for DI (`server/src/routes/reports.js:14`); transport abstracted behind `IMeshTransport` (`mobile/src/mesh/MockMeshTransport.ts:58`); shared `pg.Pool` + transaction helper (`server/src/db/pool.js:84`).
**Weaknesses:** `socketLocations` is a per-process in-memory `Map` (`server/src/services/realtimeService.js:9`) — disaster targeting breaks across instances; client/server type drift (mobile `ReportStatus` has 6 statuses, server 9 — `mobile/src/api/apiClient.ts:6`); six dead tables.
**Severity:** 🟠 Major (scalability) / 🟡 Minor (drift).

### 4.3 Code Quality & Maintainability — *Maturity 3 · 65%*
**Standard:** Consistent, low-duplication, linted/formatted, no dead code.
**Actual:** Consistent style, thorough JSDoc, sensible naming.
**Gaps:** no ESLint/Prettier config anywhere; haversine SQL copy-pasted 4× (`reportStore.js:124`, `reportStore.js:272`, `server/src/routes/shelters.js:43`, `server/src/services/triggerEngine.js:62`) and the trigger copy is **missing the `LEAST(1.0,…)` clamp** the others have → latent `acos(>1)=NaN`; dead schema; pervasive inline styles in `GovView.vue`; stale `server/report-safe.db*` SQLite files **tracked in git** despite a PostgreSQL backend.
**Severity:** 🟡 Minor (🟠 for the missing-clamp line).

### 4.4 API Design — *Maturity 3 · 65%*
**Standard:** Consistent contracts, correct status codes, versioning, pagination, idempotency, docs.
**Actual (good):** Uniform `{ ok, … }` envelope; Zod validation; correct 201/400/401/404/500; idempotent upsert; coarse-vs-full location tiers honored (`reportStore.js:98` drops `lat/lng/medical/phone`).
**Gaps:** no version prefix; **no pagination** — search hard `LIMIT 100` (`reportStore.js:93`), `/rescue` unbounded (`reportStore.js:118`); no OpenAPI; no `GET /api/reports/:id`; inconsistent auth (shelter writes guarded, all user/link routes open).
**Severity:** 🟠 Major (pagination) / 🟡 Minor (versioning/docs).

### 4.5 Data Layer — *Maturity 3 · 60%*
**Standard:** Sound schema, useful indexes, integrity, real migrations, no N+1, transactions.
**Actual (good):** CHECK constraints; child FKs with cascade; transactional seed (`server/src/db/seed.js:130`); idempotent upsert.
**Gaps:**
- **Geo queries can't use any index** — haversine over a full scan (`reportStore.js:134`); only a B-tree `(lat,lng)` exists (`setup.js:233`), useless for great-circle predicates. RFD's GiST index (`RFD_GAP_ANALYSIS.md` line ~556) **not** created; PostGIS optional (`setup.js:7`).
- **Search defeats its index:** `name ILIKE '%q%'` leading wildcard (`reportStore.js:92`).
- **No FK** `reports.disaster_id → disasters.id` (plain `TEXT`).
- **Ad-hoc migrations** with `EXCEPTION WHEN OTHERS THEN NULL` (`setup.js:51`) silently swallow all DDL errors; no versioned migration tool.
- Epoch `BIGINT` timestamps, not `timestamptz`.
**Severity:** 🟠 Major.

### 4.6 Security — *Maturity 2 · 40%* — weakest dimension
**Standard:** OWASP Top 10 / ASVS — authn/authz on sensitive data, least privilege, rate limiting, secrets, transport.
**Actual:**
- **A01 Broken Access Control (severe):** the **entire `/api/users/*` surface is unauthenticated** (`server/src/index.js:62` mounts it with no guard). Any caller can `GET /api/users/:phone/profile` (`users.js:40`), `PATCH /api/users/:id` with no ownership check (`users.js:56`), and `GET /api/users/:id/links` to dump a person's family network + each member's status/disaster/timestamp (`users.js:135`). IDs are the only "secret."
- **Unauthenticated victim enumeration:** public `GET /api/reports/search` returns name + status + ~1 km location (`server/src/routes/reports.js:40`).
- **Single shared static token** grants full exact-GPS + medical + phone for all victims (`server/src/lib/authGuard.js:25`), compared with `!==` (not constant-time); no per-actor identity, **no audit** (the `audit_logs` table is never written).
- **No rate limiting** anywhere (no `helmet`/`express-rate-limit` in the repo); RFD's "5 links/hour" is unimplemented.
- **CORS `*`** on Express (`index.js:40`) and Socket.IO (`realtimeService.js:15`); no security headers.
- **Good:** SQL fully parameterized; Zod validation; `.env` gitignored.
**Severity:** 🟠 Major (the user-subsystem IDOR is the standout; 🔴 if those endpoints ship enabled).

### 4.7 Performance & Efficiency — *Maturity 2 · 50% (mostly unverified)*
**Standard:** No avoidable full scans, caching where hot, measured latencies.
**Actual:** Likely bottlenecks (static): full-scan haversine on every `/rescue` and `/shelters`; leading-wildcard search; `getStats` runs 11 correlated `COUNT` subqueries (`reportStore.js:181`) on **every** report POST (`reports.js:30`) *and* every 10 s (`realtimeService.js:39`); no caching. Mobile `fetch` has **no timeout** (`mobile/src/api/apiClient.ts:69`).
**Gap:** Real numbers (p95, query cost, bundle size) **unverified** — see §8.
**Severity:** 🟠 Major at disaster scale.

### 4.8 Reliability & Resilience — *Maturity 3 · 65%*
**Standard:** Graceful failure, retries/timeouts, idempotency, no silent loss.
**Actual (strong):** Outbox-first write before network (`mobile/src/services/syncService.ts:27`); idempotent enqueue (`mobile/src/db/outboxDb.ts:71`) + server upsert; rising-edge reconnect flush (`mobile/src/services/connectivityWatcher.ts:39`); pool idle-error handler (`pool.js:58`); timers `unref()`'d.
**Weaknesses:** no retry/backoff; `escalateStaleReports` swallows errors → zeros (`reportStore.js:259`); no fetch timeouts. **Domain concern:** an unattended `need_help` (P1) auto-**downgrades** to `awaiting_response` (P3) after 45 min (`reportStore.js:236` + priority map `reportStore.js:13`) — the longer unrescued, the *lower* in the queue; confirm intent.
**Severity:** 🟠 Major (triage-downgrade) / 🟡 Minor (retries/timeouts).

### 4.9 Scalability — *Maturity 2 · 45%*
**Standard:** Stateless app tier, horizontally scalable, bounded queries.
**Actual:** Effectively **single-instance** — socket→location map is in-process (`realtimeService.js:9`) with no Socket.IO Redis adapter; the 10 s stats broadcaster runs per instance. Unbounded `/rescue` + O(n) geo scans cap throughput. DB tier is poolable/clusterable.
**Severity:** 🟠 Major.

### 4.10 Testing Readiness — *Maturity 1 · 20%* — headline blocker
**Standard:** Green, representative suite + CI as the precondition for meaningful case testing.
**Actual:** `npx vitest run` → **14 failed, 4 passed.**
- `tests/reportStore.test.js` (7) and `tests/triggerEngine.test.js` (6) call `getDb()`, use `process.env.DB_PATH=':memory:'`, and synchronous `prepare().run()` — the **better-sqlite3 era API**. Current `setup.js:258` exports `{ setup, closeDb, getPool }` (no `getDb`), and the store is **async `pg`** → `getDb is not a function`.
- `tests/syncService.test.ts:116` fails: mock returns bare `true` while `syncService.ts:56` destructures `{ ok }` — a real test/impl **contract drift**.
- No CI (`.github/workflows` absent), no integration/e2e, no pg test harness. README's coverage claim is currently false.
**Severity:** 🔴 Blocker.

### 4.11 Observability — *Maturity 2 · 35%*
**Standard:** Structured logs, metrics, tracing, alerting, health checks.
**Actual:** Useful `/api/health` (stats + uptime, `server/src/index.js:48`). Otherwise 47 raw `console.*` calls, no levels/request logging/correlation IDs; no metrics, tracing, or alerting.
**Severity:** 🟠 Major (prod) / 🟡 (testing).

### 4.12 DevOps & Deployment — *Maturity 3 · 50%*
**Standard:** Reproducible builds, externalized config, IaC, rollback, 12-Factor.
**Actual (good):** `docker-compose.yml` (PostGIS), thorough `.env.example`, config via env, server serves the built SPA as one artifact (`index.js:64`), npm workspaces.
**Gaps:** no app Dockerfile, no CI/CD, no IaC, no documented rollback; orchestrator healthcheck not wired to `/api/health`; stale `.db` files tracked.
**Severity:** 🟠 Major (no pipeline) / 🟡 Minor.

### 4.13 Frontend Quality — *Maturity 3 · 63%*
**Standard:** WCAG, responsive, loading/empty/error states, sensible state mgmt, CWV.
**Actual:** Rich Vue EOC dashboard with loading/empty/success states and some a11y (`aria-pressed`, `aria-label`, labeled inputs — `web/src/views/GovView.vue:464`, `web/src/views/ReportView.vue:190`); mobile uses safe-area + Ionicons.
**Concerns:** heavy inline styling hurts maintainability; full WCAG + Core Web Vitals **unverified**; **proxy-only conflict** — `ReportView.vue` is a full geolocated self-report form, contradicting A6 (feeds §4.B2).
**Severity:** 🟠 Major (proxy conflict) / 🟡 Minor (a11y unverified).

### 4.14 Documentation — *Maturity 3 · 65%*
**Standard:** Accurate README, setup, architecture, API docs, runbooks.
**Actual:** Excellent RFD, accurate CLAUDE.md, strong inline docs/migration notes.
**Gaps:** `README.md` is **stale/self-contradictory** — SQLite/better-sqlite3 (`README.md:54`) + Expo SDK 51 (`README.md:57`) vs actual `pg` + Expo 54; gov token `GOV-SECRET-TOKEN-2024` in README/CLAUDE vs `GOV-SECRET-TOKEN` in code (`authGuard.js:10`) and `.env.example`. No API reference/OpenAPI; no runbook.
**Severity:** 🟡 Minor (but causes tester friction).

### 4.15 Compliance — Hong Kong / PDPO — *Maturity 2 · 35%*
**Standard:** **Personal Data (Privacy) Ordinance (Cap. 486)** and its 6 Data Protection Principles (DPP1 collection limitation; DPP2 accuracy & retention; DPP3 use limitation; DPP4 security; DPP5 openness; DPP6 access & correction), enforced by the PCPD. Disaster metrics → HKO standards.
**Actual / gaps:**
- The system stores names, phones, **medical notes**, and **precise GPS** of HK individuals.
- **DPP4 (security):** unauthenticated PII endpoints (§4.6, `users.js`) and a single shared token are unlikely to be "all practicable steps" to protect personal data.
- **DPP1/DPP3 (collection/use):** `users.privacy_consent` exists (`setup.js:179`) but is **never consulted** by the rescue query; purpose/consent not enforced. RFD's own consent open-question is unresolved in code.
- **DPP2 (retention):** no retention/erasure policy.
- **DPP6 (access/correction):** no data-subject access or correction mechanism.
- **Accountability:** `audit_logs` table is never written → no access trail.
- **Cross-border:** if hosted outside HK, document the transfer (PCPD guidance on PDPO s.33).
- **Disaster metrics (HKO):** see §4.1 — model not aligned to HKO TC/Rainstorm signals.
**Severity:** 🟠 Major (now in-scope under A5).

---

## 5. Gap Analysis

### 🔴 Blockers — fix before case testing is meaningful
- **B1.** Test suite red (14/18 fail); server tests reference removed `getDb`/sync API; mobile test contract drift; no CI.
- **B2.** Web=proxy-only + "never counted" intent not implemented; web self-reports, location-tags, mints fresh UUID (no merge), stored as `mobile` → counted. (`ReportView.vue`, `zodSchemas.js:27`, `reportStore.js:47`/`:178`.)

### 🟠 Major — fix before production (decide before testing)
- **M1.** `/api/users/*` unauthenticated; IDOR + PII/family enumeration (`users.js`).
- **M2.** No rate limiting anywhere.
- **M3.** Single-instance only — in-memory `socketLocations`, no Redis adapter (`realtimeService.js:9`).
- **M4.** Geo full-scan; no spatial index; leading-wildcard search (`reportStore.js:92`/`:134`).
- **M5.** `need_help` auto-downgrades below triage line after 45 min — confirm intent (`reportStore.js:236`).
- **M6.** Migrations swallow all errors (`setup.js:51`).
- **M7.** No pagination on search/rescue.
- **M8.** Observability: `console.*` only; no structured logs/metrics/tracing.
- **M9.** No CI/CD or app Dockerfile.
- **M10.** PDPO: `privacy_consent` unenforced; no audit trail/retention/access mechanism.
- **M11.** Disaster model not aligned to HKO standards (`triggerEngine.js`).

### 🟡 Minor — improvements
- Six dead tables — wire up or remove.
- `findDuplicateActive` missing `LEAST(1.0,…)` clamp → NaN risk (`triggerEngine.js:62`).
- Mobile↔server status/type drift (`apiClient.ts:6`).
- Stale README (DB engine, SDK version, token); no API reference.
- Tracked `server/report-safe.db*` artifacts; remove + gitignore.
- No ESLint/Prettier; mobile `fetch` has no timeout.
- CORS `*`; no `helmet`; non-constant-time token compare.

---

## 6. Prioritized Recommendations (impact vs. effort)

| # | Change | Why | Effort | Benefit |
|---|---|---|---|---|
| R1 | Rewrite the 3 broken tests against the async `pg` store; fix the mobile mock to return `{ok:true}`; stand up disposable Postgres (testcontainers / existing compose) for them. | Restores the regression net. | M | Green baseline (clears B1). |
| R2 | Implement the confirmed **web-proxy/merge** model: web = proxy-only (no self-status, no browser GPS), proxy report keyed to `reported_for_user_id` and merged per *(person × disaster)* with mobile location authoritative; tag web-origin writes; ensure they're never counted. Add `user_type` to `ReportSchema`/`upsertReport`. | Restores the data-integrity invariant. | M | Clears B2; accurate stats. |
| R3 | Add authn + ownership checks to `/api/users/*`; rate-limit link/search/register. | Closes IDOR/PII enumeration (PDPO DPP4). | M | Biggest security/compliance win. |
| R4 | Add CI (install → lint → `vitest run` against ephemeral Postgres). | Keeps R1 from rotting. | S–M | Continuous signal. |
| R5 | Make geo index-able: PostGIS `GEOGRAPHY` + GiST + `ST_DWithin`, or a bounding-box prefilter; trigram index or prefix match for search. | Removes the dominant scale bottleneck. | M | Sub-linear geo queries. |
| R6 | Socket.IO Redis adapter + externalize `socketLocations`. | Enables >1 instance for surge. | M | Horizontal scalability. |
| R7 | Confirm/redesign the `need_help`→`awaiting_response` escalation. | Triage correctness / patient safety. | S | Correct rescue ordering. |
| R8 | Replace `EXCEPTION WHEN OTHERS THEN NULL` with targeted handling; adopt a migration tool (node-pg-migrate). | Stops silent migration failures. | S–M | Safe, auditable schema. |
| R9 | Align the disaster model to **HKO** (TC signals T1/T3/T8a–d/T9/T10; Rainstorm Amber/Red/Black) and HK-localize seed/feeds. | Compliance + correctness for HK. | M | Correct local semantics. |
| R10 | Structured logging (pino) + request logging; write `audit_logs` for privileged actions; define PDPO retention. | Observability + PDPO accountability. | M | Debuggable + compliant. |
| R11 | Decide & document scope: wire up or drop the 6 dead tables and absent RFD endpoints; mark later phases out of scope. | Stops QA writing cases for non-features. | S | Honest scope. |

---

## 7. Suggested Quick Wins (high impact, low effort — do first)
- **R2 (tagging slice):** add `user_type` to schema/upsert; stop the web form from sending browser GPS and self-statuses (~1–2 h) → unblocks stats correctness.
- **R7:** review the 45-min downgrade (~1 h) → triage safety.
- Fix the `LEAST(1.0,…)` clamp in `findDuplicateActive` (`triggerEngine.js:62`) → removes a NaN duplicate-disaster bug.
- Refresh README (DB engine, Expo SDK, gov-token value) → testers can set up the app.
- Add `express-rate-limit` to search/register/links → cheap enumeration/DoS mitigation.
- `git rm --cached server/report-safe.db*` and gitignore.
- Fix the mobile mock in `tests/syncService.test.ts` to return `{ ok: true }` → +1 green test.

---

## 8. What to Measure During Case Testing

**Functional / correctness**
- **Web-proxy/stats integrity (B2):** confirm web cannot self-report or set its own location; confirm a web proxy report merges into the affected person's record (no duplicate) with mobile location authoritative; assert web-origin data is excluded from affected counts and `exclude_web=true` actually drops it.
- **Authz (M1):** unauthenticated attempts on `GET /api/users/:phone/profile`, `PATCH /api/users/:id`, `GET /api/users/:id/links` for IDs you don't own → expect 401.
- **Triage ordering (M5):** create `need_help`, advance past 45 min, assert position in `/rescue` vs product intent.
- **Idempotency/resilience:** double-submit a UUID (relay_count++, immutable fields preserved); kill connectivity mid-submit then restore (outbox flush, exactly-once server effect).
- **Family link matching:** two people with the same name — verify `/api/users/:id/links` doesn't cross-wire (`users.js:156` `name = u.name OR phone = u.phone`).
- **Privacy tiers (PDPO):** public/search never leaks exact GPS/medical/phone; `/rescue` requires token; medical-notes visibility matches the consent decision.
- **HKO disaster semantics (R9):** trigger thresholds map to the intended HK signals.

**Performance / load (unverified — A4)**
- p50/p95 of `POST /api/reports`, `/search`, `/rescue` at 1k/10k/100k rows; `EXPLAIN ANALYZE` `/rescue` and `/search` (expect seq scans).
- Burst: 500–1000 POSTs/min + the per-POST and 10 s `getStats` (11 subqueries) cost.
- Socket fan-out: 1k–10k concurrent clients on `stats_update`; disaster-alert targeting latency.
- Web bundle size / CWV (LCP/CLS) for HomeView + GovView; map render with 1k markers.
- Mobile submit against a stalled/half-open connection (no fetch timeout today).

**Failure-mode / chaos**
- DB down at boot and mid-request (pool recovery; clean 500s).
- Two server instances behind a balancer — verify the disaster-alert gap predicted by M3.
- Simulated migration failure — confirm the silent-swallow (M6) hides it.
- Mesh-relay path: report marked `relayed` but peer never forwards — any end-to-end confirmation? (Currently none.)
