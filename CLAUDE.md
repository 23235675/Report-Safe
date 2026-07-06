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

## 2. Deployment (Azure App Service)

- **URL:** `https://report-safe-api-23235675.azurewebsites.net/`
- **Azure account:** `kinglee.10695@gmail.com` → "Azure subscription 1" (tenant `5cfb9f61-be45-435c-9d76-0461578dab72`)
- **Resource group:** `23235675`
- **App Service Plan:** `report-safe-plan-sea` (currently **B1** / Basic, ~$13/mo; downgrade to F1 free tier when ready)
- **Runtime:** Node.js 22 LTS (Linux)
- **Startup command:** `node server/src/index.js`
- **Deploy method:** zip deploy via `az webapp deploy --type zip`. Build the zip with 7-Zip (NOT PowerShell `Compress-Archive` — it produces incompatible zips that return 400).
- **Build setting:** `SCM_DO_BUILD_DURING_DEPLOYMENT=true` (Azure runs `npm install` during deploy)
- **GitHub Pages** also configured on the `test` branch (workflow `.github/workflows/deploy-pages.yml`) but is NOT the primary deploy target — GitHub Pages can't reach the API server.
- **`vite.config.js`:** `base` is `/Report-Safe/` when `GITHUB_ACTIONS` env is set, `/` otherwise. Don't change this — it handles both deploy targets.

**Deploy steps (from project root):**
```bash
cd web && npx vite build && cd ..
"C:\Program Files\7-Zip\7z.exe" a -tzip deploy.zip package.json package-lock.json server/ shared/ web/dist/ -xr!node_modules -xr!.git
az webapp deploy --name report-safe-api-23235675 --resource-group 23235675 --src-path deploy.zip --type zip
```

**Downgrade to free tier:**
```bash
az appservice plan update --name report-safe-plan-sea --resource-group 23235675 --sku F1
```

## 3. Branches

- **`main`** — stable base
- **`test`** — active development branch; deployed to Azure and GitHub Pages

## 4. Web UI design system (AdminView + GovView)

Both dashboards use a **Word-document aesthetic** — grey toolbars, white content, no vivid colors in the chrome.

**Fonts:** `var(--font-ui)` = Plus Jakarta Sans; `var(--font-mono)` = IBM Plex Mono (defined in `web/src/assets/main.css`).

**Colour palette (admin + gov chrome):**
- Topbar / table headers: `#e8e8e8`
- Sidebar / navigation tabs: `#f0f0f0`
- Content background: `#fff`
- Borders: `#d0d0d0`
- Text: `#222` (primary), `#555` (secondary), `#888` (muted)
- Login background: `#f0f0f0`

**Login screens (both views):**
Both share the same centered layout:
- `報` crest icon (40×40 grey box) centered at top
- "Report Safe" title + subtitle centered below
- Separator line, then form fields
- Full-width sign-in button
- Footer note

**AdminView (`/admin`):**
- Fully monochrome — **no status colours**. Status badges are rectangular with `border-radius:0` (sharp corners), `border:1px solid #d0d0d0`.
- Scoped CSS in `AdminView.vue` lines ~462–575.

**GovView (`/gov`):**
- Same grey/white chrome but **keeps vivid status colours** from `STATUS_COLOR_VIVID` in `iconography.js`.
- Proportion ring colours: `.clear-green { background:#16a34a }`, `.clear-red { background:#dc2626 }`.
- Status overview shows REPLIED / UNACCOUNTED colours.
- Scoped CSS in `GovView.vue` lines ~752–914.

**Other views** (Home, Status, Account, Shelters, Report, Family) use the app's standard Pine design tokens from `main.css` — don't apply the grey/white overrides to them.

## 5. Server request lifecycle (`server/src/index.js → bootstrap()`)

1. Load `server/.env` **relative to the file** (so CWD never changes behaviour).
2. Connect Redis **if configured** — otherwise run single-instance (graceful no-op).
3. `db/setup.js` → connect Mongo, create collections + indexes (no per-collection throughput).
4. Seed demo data only if empty (`db/seed.js`) + provision super admin from env (`db/seedAdmin.js`).
5. Build Express: `securityHeaders → cors → requestLogger → json(2mb) → /api rate limit`.
6. HTTP + Socket.IO (Redis adapter when available).
7. Health split: `/api/live` (always 200) · `/api/ready` (503 if Mongo/Redis down) · `/api/metrics` · `/api/health` (legacy).
8. Mount routers (section 7), then serve `web/dist`, then the **central error handler last**.
9. Start background engines: trigger (disasters) · incident (CFR 999) · missing-person escalation · retention purge.
10. Graceful shutdown on SIGTERM/SIGINT: stop timers → drain HTTP → close Mongo → quit Redis.

## 6. Module map (where things live)

| Area | Files | Responsibility |
|---|---|---|
| Entry | `src/index.js` | bootstrap, middleware, route mounting, shutdown |
| DB | `src/db/{mongo,setup,seed,seedAdmin,reset}.js` | connection (`getDb()`, `collection(name)`), schema/indexes, seeding |
| Data access | `src/services/{reportStore,userStore,linkStore,shelterStore,safePlaceStore,deviceStore,disasterStore,missingPersonStore,incidentStore}.js` | one store per domain — ALL Mongo access; raw docs never leave a store un-mapped |
| Policy | `src/services/reportPolicy.js` | report-ingest rulebook (identity, proxy rules, never-lose) |
| Realtime | `src/services/realtimeService.js` | Socket.IO init + the hub (`emitGlobal`/`emitToUsers`/`emitInRadius`) every broadcast uses |
| Engines | `src/services/{triggerEngine,incidentEngine,missingPersonService,retentionService}.js` | polling/escalation/purge jobs |
| Routes | `src/routes/*.js` + `src/routes/admin/*` | one `createXRouter(io?)` factory per resource — parse, authorize, delegate, respond |
| Lib | `src/lib/{authGuard,http,zodSchemas,rateLimit,httpSecurity,logger,errorHandler,geo,audit,otpService,pushService,redisClient,leaderLock,mongoMap}.js` | cross-cutting helpers (`lib/http` = HttpError/asyncHandler/validate) |
| Shared vocab | `shared/{statuses,hkid,phone}.js` | canonical status/HKID/phone rules — server imports directly; web/mobile copies are drift-checked in CI (`scripts/check-shared-drift.mjs`). The deploy zip and Dockerfile MUST include `shared/` |
| Web views | `web/src/views/{AdminView,GovView,HomeView,StatusView,AccountView,SheltersView,ReportView,FamilyView}.vue` | Vue 3 SFC with `<script setup>` |
| Shared UI | `web/src/iconography.js` | `STATUS_SHORT`, `STATUS_COLOR_VIVID`, severity helpers |
| Router | `web/src/router/index.js` | Vue Router with `createWebHistory(import.meta.env.BASE_URL)` |

## 7. Conventions (match these — don't invent new ones)

- **Route factories.** Every router is a `module.exports = function createXRouter(io) { … return router }`. Routers needing realtime take `io`; mount under `/api/<resource>` in `index.js`. Every router ends with `router.use(errorHandler)` so it works standalone (tests mount routers bare).
- **Validation at the boundary.** Every body/query is parsed by the `validate(schema, source?)` middleware from `lib/http.js` (Zod schemas live in `lib/zodSchemas.js`); handlers read `req.valid` and never touch `req.body` for validated shapes. Add new input rules to `lib/zodSchemas.js`, not inline.
- **Doc → response mapping.** Never return a raw Mongo doc. Map through a helper that renames `_id → id` and **strips internal/secret fields**: `fromDoc` (drops `name_lower`), `publicUser` in `userStore` (drops `*_hash`, masks HKID). These destructure-to-omit functions are **load-bearing** — the omitted bindings are intentional, not dead code (eslint `ignoreRestSiblings:true` keeps the linter quiet). Mapping happens at the STORE boundary and nowhere else.
- **Errors.** Handlers throw `HttpError(status, message, code?)` from `lib/http.js` for 4xx and never hand-roll try/catch; `asyncHandler` routes rejections to `errorHandler`, which returns `{ error: <string>, code?, reqId }` for exposed 4xx and a masked 500 otherwise — never a stack to the client.
- **Logging.** Use `lib/logger` (`logger.info('event_name', {…})`), not `console.*`, in request/engine paths — enforced by eslint `no-console`. `console` is only for the `db/` CLI scripts.
- **Geo.** All radius queries go through `lib/geo.js#findWithinRadius` (index-friendly bounding box → exact haversine, parameterized filter/projection/sort/cap). Don't re-implement the box+haversine loop inline.
- **Realtime.** All targeted broadcasts go through the hub in `realtimeService` (`emitGlobal` / `emitToUsers` / `emitInRadius`); never iterate `fetchSockets()` elsewhere.
- **Shared vocabulary.** Status lists/priorities, HKID and phone rules are canonical in `shared/` — the server imports them; the web/mobile copies must stay behaviorally identical (CI runs `scripts/check-shared-drift.mjs`).

### Architectural guardrails (the five rules for every new endpoint)

1. Handlers are ≤ 15 lines and nesting-free: guard clauses only, no `else` after a `return`. If a handler needs a second level of `if`, the logic belongs in a policy or store module.
2. No business logic or `collection()` calls in route files (enforced by eslint `no-restricted-imports` on `db/mongo` for top-level routes). A route parses, authorizes, delegates to one domain function, and shapes the envelope.
3. Validation happens once, at the boundary, via `validate(schema)` — admin routes included.
4. One error path, one logger: throw `HttpError`, let `asyncHandler`/`errorHandler` respond, log via `lib/logger` only.
5. One implementation per concept — token auth = `requireRole`, radius queries = `findWithinRadius`, broadcasts = the realtime hub, partial updates = `pickProvided`. A PR introducing a parallel copy of an existing concept must delete the old one.

## 8. Key endpoints (full table in README §Core APIs)

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

## 9. Auth model (three independent paths)

- **Citizen token:** short-lived Bearer access + long-lived **rotating** refresh (only hashes stored). TTLs: `ACCESS_TOKEN_TTL_HOURS`/`REFRESH_TOKEN_TTL_DAYS`.
- **Gov:** static `GOV_TOKEN` (timing-safe compare; warns at boot if the built-in default is left in prod).
- **Super admin:** `super_admin` role, scrypt password login, every mutation audited. Provisioned from `SUPER_ADMIN_*` env — never hardcoded.

All enforced in `lib/authGuard.js`.

## 10. Testing

- Run `npm test` from repo root (Vitest). **Local Mongo must be up** (`npm run db:up`); Redis is optional (its suite self-skips).
- **No Docker on the machine?** `npm run test:memdb` runs the same suite (minus the Redis suite) against an ephemeral `mongodb-memory-server` instance — no external services needed.
- `tests/_env.setup.js` **forces** `MONGODB_DB=reportsafe_test`; `tests/_global.setup.js` drops it once per run. Suites run **sequentially** (`fileParallelism:false`) because they share one DB and DELETE between tests. Never point tests at the cloud DB.
- Mobile: `cd mobile && npx tsc --noEmit` (strict) + its vitest pure-logic units (HKID/severity). Web: `cd web && npm run build`.

## 11. GUARDRAILS — do not break these

1. **Cosmos free tier.** The account MUST be created with `--enable-free-tier true` (creation-only, one per subscription) — otherwise the provisioned 1,000 RU/s is billed against the ~100 RU/s grant. Keep one DB on shared throughput and the account `totalThroughputLimit = 1000`; do **not** create dedicated-throughput collections (13 × 400 RU/s would bill). `setup.js` deliberately calls `createCollection` with no throughput option.
2. **`trust proxy` = exact hop count** (`TRUST_PROXY_HOPS`; Azure App Service = 1). Don't blanket-trust forwarded headers — it lets a spoofed `X-Forwarded-For` bypass IP rate limits.
3. **Rate limiting fails *closed*.** A Redis outage must not silently disable abuse protection. Report ingest keeps its own user-keyed limiter so a surge can't starve status/shelter reads.
4. **Web is proxy-only.** It cannot self-report or report "safe", has no browser GPS, never receives alerts, and is **excluded from official stats**. Only mobile reports count toward affected numbers.
5. **Never leak secret/internal fields.** Always go through `publicUser`/`fromDoc`. Token/password hashes and `name_lower` must not reach clients.
6. **PDPO.** `privacy_consent === true` is required to register; `DELETE /api/users/:id` performs the erasure cascade (idempotent); HKID is always masked in responses; privileged actions are audited.
7. **Graceful degradation.** Redis, Azure Notification Hubs, and OTP are all optional — absent config = clean no-op, not a crash. Keep new integrations the same way.
8. **Registration contract.** `gender` (`'male' | 'female'`) is **required** — it is wired through mobile, web, seed, and the status roster. If you touch `UserRegisterSchema`, update the clients **and** the test payloads together (a mismatch is what last broke the suite).

## 12. Working style for agents

- This codebase already went through a remediation pass and is intentionally lean. **Prefer surgical, verified edits over rewrites.** Don't "tidy" the destructure-to-omit helpers, the two-phase PDPO erasure, the box+haversine double filter, the separate ingest limiter, or the always-false mesh stub — they exist on purpose.
- After any server change, run `npm test` (green = 20 files / 159 tests) before considering it done.
- It is deployed (Azure). Treat behaviour changes as production changes: keep schemas, routes, and the guardrails above intact unless explicitly asked to change them.
- **For UI changes to AdminView/GovView:** follow the grey/white Word-document design. AdminView is monochrome; GovView keeps vivid status colours. Both use `var(--font-ui)` and `var(--font-mono)`. All elements use `border-radius:0` or `border-radius:2px` max — no rounded corners.
- **To deploy after changes:** build web (`cd web && npx vite build`), create zip with 7-Zip (exclude node_modules, **include `shared/`**), `az webapp deploy --type zip`. Don't use PowerShell `Compress-Archive`.
