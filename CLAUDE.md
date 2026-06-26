# CLAUDE.md — AI / Developer Context

Authoritative quick-context for **Report Safe (報平安)**, a Hong Kong disaster-status
reporting system. Read this before changing code so you extend the system the way it
is built — not around it. User-facing setup lives in [README.md](README.md); this file
is the internal map + the **guardrails** that must not be broken.

> **Core invariant:** a citizen's report is never lost. It is written locally first and
> delivered the moment connectivity returns.

---

## 1. Repository shape (npm workspaces)

```
server/   Express 4 + Socket.IO 4 + MongoDB 7 (Cosmos for MongoDB in prod). The API + realtime + background engines.
web/      Vue 3 + Vite + Leaflet. Gov dashboard + family proxy-reporting. Built to web/dist and served by the server in prod.
mobile/   React Native 0.85 + Expo SDK 56 + TypeScript (strict). The citizen emergency path. Offline-first (expo-sqlite outbox).
tests/    Vitest suites for the server (run from repo root). Mobile has its own pure-logic units under mobile/src.
```

Root scripts: `npm run dev` (server+web), `npm test` (vitest), `npm run db:up | db:reset`.

## 2. Server request lifecycle (`server/src/index.js → bootstrap()`)

1. Load `server/.env` **relative to the file** (so CWD never changes behaviour).
2. Connect Redis **if configured** — otherwise run single-instance (graceful no-op).
3. `db/setup.js` → connect Mongo, create collections + indexes (no per-collection throughput).
4. Seed demo data only if empty (`db/seed.js`) + provision super admin from env (`db/seedAdmin.js`).
5. Build Express: `securityHeaders → cors → requestLogger → json(2mb) → /api rate limit`.
6. HTTP + Socket.IO (Redis adapter when available).
7. Health split: `/api/live` (always 200) · `/api/ready` (503 if Mongo/Redis down) · `/api/metrics` · `/api/health` (legacy).
8. Mount routers (section 4), then serve `web/dist`, then the **central error handler last**.
9. Start background engines: trigger (disasters) · incident (CFR 999) · missing-person escalation · retention purge.
10. Graceful shutdown on SIGTERM/SIGINT: stop timers → drain HTTP → close Mongo → quit Redis.

## 3. Module map (where things live)

| Area | Files | Responsibility |
|---|---|---|
| Entry | `src/index.js` | bootstrap, middleware, route mounting, shutdown |
| DB | `src/db/{mongo,setup,seed,seedAdmin,reset}.js` | connection (`getDb()`, `collection(name)`), schema/indexes, seeding |
| Data access | `src/services/reportStore.js` | reports/users/links queries, stats, PDPO erasure cascade |
| Realtime | `src/services/realtimeService.js` | Socket.IO init, room/broadcast logic, stats timer |
| Engines | `src/services/{triggerEngine,incidentEngine,missingPersonService,retentionService}.js` | polling/escalation/purge jobs |
| Routes | `src/routes/*.js` + `src/routes/admin/*` | one `createXRouter(io?)` factory per resource |
| Lib | `src/lib/{authGuard,zodSchemas,rateLimit,httpSecurity,logger,errorHandler,geo,audit,otpService,pushService,redisClient,leaderLock,mongoMap}.js` | cross-cutting helpers |

## 4. Conventions (match these — don't invent new ones)

- **Route factories.** Every router is a `module.exports = function createXRouter(io) { … return router }`. Routers needing realtime take `io`; mount under `/api/<resource>` in `index.js`.
- **Validation at the boundary.** Parse every request body with a Zod schema from `lib/zodSchemas.js` (`Schema.safeParse(req.body)` → 400 on failure). Add new input rules there, not inline.
- **Doc → response mapping.** Never return a raw Mongo doc. Map through a helper that renames `_id → id` and **strips internal/secret fields**: `fromDoc` (drops `name_lower`), `publicUser` (drops `*_hash`, masks HKID). These destructure-to-omit functions are **load-bearing** — the omitted bindings are intentional, not dead code (`.eslintrc` `ignoreRestSiblings:true` keeps the linter quiet).
- **Errors.** Routes hand-roll try/catch + JSON; anything that escapes hits the central `errorHandler` (clean envelope + reqId, never a stack to the client).
- **Logging.** Use `lib/logger` (`logger.info('event_name', {…})`), not `console.*`, in request/engine paths. `console` is only for the `db/` CLI scripts.
- **Geo.** Distance/radius work goes through `lib/geo.js` + the bounding-box prefilter in `reportStore.js` (index-friendly box → exact haversine). Don't re-implement haversine inline.

## 5. Key endpoints (full table in README §Core APIs)

| Path | Auth | Note |
|---|---|---|
| `POST /api/users/register` | — | **Requires `phone, name, gender, personal_id, privacy_consent`** → access + rotating refresh tokens |
| `POST /api/users/token/refresh` | — | One-time-use refresh; reuse nukes the token family |
| `POST /api/reports` | — | Idempotent upsert on UUID; has its **own** rate limiter (excluded from the global one) |
| `GET /api/reports/stats` | — | Mobile-only counts; web proxy-reports excluded (`excludeWeb=true`) |
| `GET /api/reports/rescue` | Gov (Bearer `GOV_TOKEN`) | Full triage incl. PII/GPS |
| `POST /api/disasters/trigger` | Gov | Broadcasts to in-radius mobile devices only |
| `POST /api/incidents` · `…/respond` · `…/resolve` | Gov / Token | CFR 999 dispatch lifecycle |
| `POST /api/admin/login` + `/api/admin/*` | super_admin (scrypt) | CRUD + audit over all collections |

## 6. Auth model (three independent paths)

- **Citizen token:** short-lived Bearer access + long-lived **rotating** refresh (only hashes stored). TTLs: `ACCESS_TOKEN_TTL_HOURS`/`REFRESH_TOKEN_TTL_DAYS`.
- **Gov:** static `GOV_TOKEN` (timing-safe compare; warns at boot if the built-in default is left in prod).
- **Super admin:** `super_admin` role, scrypt password login, every mutation audited. Provisioned from `SUPER_ADMIN_*` env — never hardcoded.

All enforced in `lib/authGuard.js`.

## 7. Testing

- Run `npm test` from repo root (Vitest). **Local Mongo must be up** (`npm run db:up`); Redis is optional (its suite self-skips).
- `tests/_env.setup.js` **forces** `MONGODB_DB=reportsafe_test`; `tests/_global.setup.js` drops it once per run. Suites run **sequentially** (`fileParallelism:false`) because they share one DB and DELETE between tests. Never point tests at the cloud DB.
- Mobile: `cd mobile && npx tsc --noEmit` (strict) + its vitest pure-logic units (HKID/severity). Web: `cd web && npm run build`.

## 8. GUARDRAILS — do not break these

1. **Cosmos free tier.** The account MUST be created with `--enable-free-tier true` (creation-only, one per subscription) — otherwise the provisioned 1,000 RU/s is billed against the ~100 RU/s grant. Keep one DB on shared throughput and the account `totalThroughputLimit = 1000`; do **not** create dedicated-throughput collections (13 × 400 RU/s would bill). `setup.js` deliberately calls `createCollection` with no throughput option.
2. **`trust proxy` = exact hop count** (`TRUST_PROXY_HOPS`; Azure App Service = 1). Don't blanket-trust forwarded headers — it lets a spoofed `X-Forwarded-For` bypass IP rate limits.
3. **Rate limiting fails *closed*.** A Redis outage must not silently disable abuse protection. Report ingest keeps its own user-keyed limiter so a surge can't starve status/shelter reads.
4. **Web is proxy-only.** It cannot self-report or report "safe", has no browser GPS, never receives alerts, and is **excluded from official stats**. Only mobile reports count toward affected numbers.
5. **Never leak secret/internal fields.** Always go through `publicUser`/`fromDoc`. Token/password hashes and `name_lower` must not reach clients.
6. **PDPO.** `privacy_consent === true` is required to register; `DELETE /api/users/:id` performs the erasure cascade (idempotent); HKID is always masked in responses; privileged actions are audited.
7. **Graceful degradation.** Redis, Azure Notification Hubs, and OTP are all optional — absent config = clean no-op, not a crash. Keep new integrations the same way.
8. **Registration contract.** `gender` (`'male' | 'female'`) is **required** — it is wired through mobile, web, seed, and the status roster. If you touch `UserRegisterSchema`, update the clients **and** the test payloads together (a mismatch is what last broke the suite).

## 9. Working style for agents

- This codebase already went through a remediation pass and is intentionally lean. **Prefer surgical, verified edits over rewrites.** Don't "tidy" the destructure-to-omit helpers or the deliberate `// eslint-disable` on the 4-arg error middleware — they exist on purpose.
- After any server change, run `npm test` (green = 20 files / 159 tests) before considering it done.
- It is deployed (Azure). Treat behaviour changes as production changes: keep schemas, routes, and the guardrails above intact unless explicitly asked to change them.
