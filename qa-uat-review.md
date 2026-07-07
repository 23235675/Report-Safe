# QA / Test-Coverage Review — Report Safe (報平安)

> **Scope:** the state of the automated test suite — what it covers, what it doesn't, and
> where the **UAT (manual acceptance)** layer has to carry the load. Kept current with the
> codebase; the remediation tracked in §7 is done and verified.
>
> **Method:** every suite under `tests/`, `web/src`, and `mobile/src` was read and mapped
> against the server routes/services/lib, the mobile logic, and the guardrails in
> [`CLAUDE.md`](CLAUDE.md). The full suite was executed against an ephemeral MongoDB and
> **coverage was measured** (§5).
>
> **Bottom line:** automated coverage is now **effectively complete for everything a test
> can reach**. Every server route, service, engine, and cross-cutting lib module is covered
> — including the realtime **hub**, the ingest **policy**, the leader lock, and the logger —
> and the testable mobile logic (sync, report-form, location) has units. A **coverage floor**
> guards against regression. What genuinely remains is **not unit-testable**: the Socket.IO
> **server bootstrap** (connection/register handlers — needs a live socket server + client)
> and the **UI itself** (Vue dashboards, RN screens), which only a UAT pass exercises.

---

## 1. How the suite is wired

| | |
|---|---|
| **Runner** | Vitest 4 (`npm test` → `vitest run`; `npm run test:coverage` adds the v8 floor) |
| **Root config** | [`vitest.config.mjs`](vitest.config.mjs) — `fileParallelism:false` (suites share one DB and DELETE between tests); global + env setup pin every suite to a **disposable local Mongo** and force `MONGODB_DB=reportsafe_test` so tests can never touch cloud Cosmos |
| **DB options** | `npm run db:up` (Docker Mongo) **or** `npm run test:memdb` (ephemeral `mongodb-memory-server`, no Docker). Redis is opt-in; the Redis suite self-skips when absent |
| **Mobile** | pure-logic + mocked-native units; run in the root suite and standalone via `mobile/vitest.config.mjs` |
| **Inventory** | **36** suites in `tests/` + **2** web + **4** mobile = **42 files / 338 tests** (333 pass, 5 Redis-suite skips locally; all run in CI) |

**CI gates** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): `lint` → `check:shared` (shared-vocab drift) → **`npm run test:coverage`** (Mongo **and** Redis provisioned, so the Redis suite *does* run, and the **coverage floor is enforced**) → `build:web` → `tsc --noEmit` (mobile). Separate jobs run `npm audit` (fail on high+), gitleaks, and CodeQL. CI runs on **push to `main`+`test`** and every PR.

---

## 2. Coverage at a glance

Legend: ✅ direct coverage · 🟡 indirect (via routes/engines) · ❌ none

### Server routes — all covered at the HTTP layer

`users` · `reports` · `disasters` · `devices` · `shelters` · `safePlaces` · `incidents` · `aed` · `missingPersons` · `admin/*` — **all ✅** (auth gates, schema validation, privacy tiers, and — for admin — an `audit_logs` write asserted per mutation).

### Server services & lib — all covered

| Module | Status | Note |
|---|---|---|
| `reportStore` · `triggerEngine` · `incidentEngine` · `missingPersonService` · `retentionService` | ✅ | store ops, thresholds/dedup/HKO, responder matching, escalation, purge |
| `userStore` · `linkStore` · `deviceStore` · `shelterStore` | ✅ | login/profile/erase; link consent; device upsert; shelter CRUD |
| `reportPolicy` | ✅ | ingest rulebook unit-tested directly (identity, proxy rules, never-lose) |
| `realtimeService` | ✅ | the **hub** (`emitGlobal`/`emitToUsers`/`emitInRadius`) + every named broadcast; **residual:** `initSocketIO` connection/register handlers (needs a live socket server — §4) |
| `authGuard` · `pushService` · `otpService` · `audit` | ✅ | tokens/gov/super-admin; payloads/SAS; one-time OTP; audit-write |
| `rateLimit` · `httpSecurity` · `errorHandler` · `geo` · `mongoMap` · `leaderLock` · `logger` | ✅ | fail-closed; headers/CORS; masked-500; haversine/box edges; mapping; leader election; JSON-line log + request-id/metrics |
| `http` · `redisClient` · `socketEvents` | ✅ | HttpError via errorHandler; redis when present; event constants |
| `disasterStore` / `missingPersonStore` / `incidentStore` / `safePlaceStore` | 🟡 | covered via their routes/engines (no isolated unit — normal for thin stores) |

### Mobile & Web

| Area | Status | Note |
|---|---|---|
| `mobile/src/services/syncService` · `utils/{hkid,severity,reportForm,location}` | ✅ | 3-layer fallback; HKID/severity; report-form gate; never-hang GPS resolve (expo mocked) |
| Mobile screens / contexts / apiClient / outboxDb / notificationService | ❌ | RN/native UI — **UAT territory** |
| `web/src/hkid`, `iconography` | ✅ | mirrors server rules; severity NaN regression guarded |
| Web Vue views (Admin/Gov/Home/Status/…) | ❌ | no component tests; `build:web` is the only smoke — **UAT territory** |

---

## 3. What's well covered (strengths)

- **Token lifecycle & auth** — expiry, refresh **rotation with reuse-detection**, timing-safe compares, an auth gate on every router, phone-only login.
- **Never-lose invariant** — idempotent upsert, relay never overwrites identity, 429-retriable vs 422-permanent, offline outbox, mesh fallback, and **rate limiting that fails closed**.
- **Family consent & escalation** — link request→confirm→remove with status hidden until both consent; confirmed-only cascade; time-based escalation to *potentially missing*.
- **PDPO** — erasure over HTTP (scrub + cascade) + tombstone finalize; retention purge (resolved-only); consent-required registration; HKID masking + coarse coords.
- **Privacy & realtime targeting** — public vs rescue (full PII) vs residential-incident tiers; and the **hub** proven to reach only the right sockets (identity / radius / mobile-only).
- **Admin & hardening** — self-lockout/passwordless guards, injection-safe filters, `audit_logs` asserted per mutation, CSP/HSTS headers, CORS wildcard-in-prod refusal, error masking.

---

## 4. Remaining gaps — not unit-testable

1. **`realtimeService.initSocketIO`** — the Socket.IO server bootstrap and its `connection`/`register` event handlers. The hub and every broadcast are covered; only the live-server wiring is not (would need a real Socket.IO server + connected client). Exercised at runtime and by the UAT socket flows.
2. **UI / end-to-end** — no test drives the Vue dashboards or the RN app as a user. The web proxy flow and the mobile offline→online flow are validated at unit/integration level, never through a real UI. See §6 + [uat-checklist.md](uat-checklist.md).
3. **No E2E / browser / load tests.**

Everything else — every route, service, engine, and lib module — is covered.

---

## 5. Coverage numbers & the floor

Measured over `server/src` (excluding `db/` CLI scripts + `index.js` bootstrap), full suite, local no-Redis run:

| Metric | Current | CI floor | Headroom |
|---|---|---|---|
| Lines | **82.3%** | 78 | +4.3 |
| Functions | **80.7%** | 77 | +3.7 |
| Statements | **77.6%** | 74 | +3.6 |
| Branches | **66.1%** | 62 | +4.1 |

The floor lives in [`vitest.config.mjs`](vitest.config.mjs), enforced by `npm run test:coverage` in CI. CI runs *with* Redis (covers `redisClient`/`rateLimit` paths this baseline skips), so the real number is a touch higher and the floor holds with margin. The residual uncovered lines are concentrated in `realtimeService.initSocketIO` (§4.1) and the thin stores' rarely-hit branches.

---

## 6. The UAT layer (manual acceptance)

Automated tests stop at the HTTP/logic boundary — **no test drives the Vue dashboards or the RN app as a user**, so a UAT pass is the *only* validation those surfaces get. The full role-based script is in **[uat-checklist.md](uat-checklist.md)** (~34 items; 🔴 must-pass gates release). Focus on the flows automation can't reach:

- **Citizen (mobile)** — register/login, submit a report **in airplane mode** and confirm it delivers on reconnect, receive an in-zone disaster alert (the live socket path).
- **Family / proxy** — **send and confirm a loved-one link on two devices**, verify the cascade reaches only *confirmed* partners; web proxy report ("safe" refused, location inherited).
- **Government** — trigger/deactivate a disaster, work the rescue triage list (full PII), run a CFR incident, watch a report **escalate to *potentially missing***.
- **Super admin** — login, confirm the audit trail populates in the UI, IP-allowlist, the self-lockout guard.

---

## 7. What this remediation added

| Suite / change | Area | Tests |
|---|---|---|
| `accountLinks` · `escalation` · `retention` | P1 engines — link consent · escalation · purge | 10 · 7 · 4 |
| `shelters` · `usersRoutes` · `adminRoutes` (extended) | P2 — shelter CRUD · user routes/erasure/device · admin sub-resources + audit-write | 12 · 19 · +12 |
| `disastersRoutes` · `reportsRoutes` | P2 route edges | 5 · 7 |
| `rateLimit` · `httpSecurity` · `errorHandler` · `geo` · `mongoMap` | P3 lib | 4 · 6 · 4 · 8 · 8 |
| `realtimeService` · `reportPolicy` · `leaderLock` · `logger` | full coverage — hub · ingest policy · leader lock · logger | 13 · 8 · 6 · 5 |
| `mobile/…/reportForm` · `mobile/…/location` | mobile logic — form gate · never-hang GPS | 8 · 6 |
| [`vitest.config.mjs`](vitest.config.mjs) + CI | v8 coverage floor; CI runs `test:coverage`; triggers on push to `test` | — |

All additive — no production code changed. Verified green against ephemeral Mongo, lint-clean, floor passing.

---

## How to run

```bash
npm run test:coverage              # full server suite + coverage floor (needs local Mongo; Redis optional)
npm run test:memdb                 # full server suite, no Docker (ephemeral Mongo, Redis suite self-skips)
cd mobile && npx tsc --noEmit && npx vitest run   # mobile typecheck + units
cd web && npm run build            # web smoke
```

Current baseline: **42 files / 338 tests** for the root run (333 pass locally + 5 Redis-suite skips; all run in CI).
