# Report Safe (報平安) — Project Guide

## What This Is
Disaster resilience app (monorepo). Citizens submit "I'm safe/injured/need help" reports. Works offline, syncs when connectivity returns. Three sub-packages: `mobile/`, `web/`, `server/`.

## Tech Stack

| Layer | Stack |
|---|---|
| Mobile | React Native 0.81.5, Expo SDK 54, TypeScript strict |
| Web | Vue 3 + Vite, Leaflet maps, socket.io-client |
| Server | Node 20, Express 4, Socket.IO 4, MongoDB (Azure Cosmos DB for MongoDB) |
| DB (local) | expo-sqlite (outbox queue on device) |
| DB (server) | MongoDB / Azure Cosmos DB for MongoDB (mongo.js, Zod schemas) |
| Auth | Static Bearer token via `GOV_TOKEN` env var |
| Testing | Vitest (`tests/` at monorepo root) |

## Monorepo Layout

```
report-safe/
├── mobile/          # Expo app
│   ├── index.js     # Entry: require('./polyfills.js') MUST be first line
│   ├── polyfills.js # DOMException polyfill (all 25 legacy codes)
│   ├── metro.config.js  # Injects polyfill via getPolyfills serializer hook
│   ├── App.tsx      # Bottom-tab navigator (Home / Report / Family)
│   └── src/
│       ├── api/apiClient.ts        # Fetch wrappers
│       ├── db/outboxDb.ts          # expo-sqlite durable queue
│       ├── mesh/                   # IMeshTransport interface + Mock impl
│       ├── screens/                # HomeScreen, ReportScreen, FamilyScreen
│       └── services/
│           ├── syncService.ts      # 3-layer delivery: internet → mesh → queue
│           └── connectivityWatcher.ts  # Flushes outbox on reconnect
├── server/src/
│   ├── index.js        # Bootstrap order: DB → seed → Express → Socket.IO → routes
│   ├── db/             # mongo.js (connection), setup.js (collections+indexes), seed.js (demo data)
│   ├── lib/            # zodSchemas.js, authGuard.js, geo.js, socketEvents.js
│   ├── services/       # reportStore.js, realtimeService.js, triggerEngine.js
│   └── routes/         # reports.js, disasters.js
└── web/src/
    ├── socket.js        # Singleton Socket.IO composable
    ├── api.js           # Fetch wrappers (relative URLs, Vite proxy)
    └── views/           # HomeView, ReportView, FamilyView, GovView
```

## Key Invariants

1. **Never lose a report** — always write to expo-sqlite outbox BEFORE attempting network delivery
2. **Idempotent relay** — reports have stable UUIDs (the Mongo `_id`); server upserts (`updateOne` bump or `insertOne`, dup-`_id`-safe) to increment relay_count
3. **3-layer sync** — internet → strongest mesh peer → stay queued; flush on reconnect
4. **Coarse location for public** — search API returns 0.01° precision; only `/rescue` (auth) gets full coords

## Critical Polyfill Note

`socket.io-client` requires `DOMException` with all 25 legacy numeric constants (`INDEX_SIZE_ERR = 1` … `DATA_CLONE_ERR = 25`). Hermes does not provide these.

- **`mobile/polyfills.js`** installs or patches `global.DOMException` with all constants
- **`mobile/metro.config.js`** injects it as a Metro serializer polyfill (runs before ALL module code)
- **`mobile/index.js`** also `require('./polyfills.js')` as belt-and-suspenders

Do NOT remove either injection point.

## API Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/reports` | — | Submit/relay report |
| GET | `/api/reports/search?q=` | — | Coarse-location name search |
| GET | `/api/reports/stats` | — | Aggregate counts |
| GET | `/api/reports/rescue?lat&lng&radius` | Bearer | Full triage view |
| GET | `/api/disasters` | — | Active disasters |
| POST | `/api/disasters/trigger` | Bearer | Manual disaster trigger |
| POST | `/api/users/register` | — | Create account → access + refresh tokens |
| POST | `/api/users/token/refresh` | — | Rotate refresh token → new access token |
| POST | `/api/devices/register` | Optional | Native push handle + location (radius-targeted push) |

Default token: `GOV-SECRET-TOKEN-2024` (env `GOV_TOKEN`)

**Token lifecycle:** access tokens expire (`ACCESS_TOKEN_TTL_HOURS`, default 24); refresh tokens rotate (`REFRESH_TOKEN_TTL_DAYS`, default 30). Only hashes stored; NULL expiry = legacy non-expiring (back-compat). See `lib/authGuard.js` (`generateTokenPair`, expiry check in `authenticate`).

**Remote push:** `lib/pushService.js` direct-sends a disaster alert via Azure Notification Hubs (FCM/APNs) to device handles inside the radius (`triggerEngine.findDevicesInRadius`) — wakes closed apps the socket can't reach. No-op without `AZURE_NH_*` env. Mobile registers its handle in `DisasterModeContext` via `notificationService.registerForRemotePush`. Full deploy guide: `DEPLOYMENT_AZURE.md`.

## Database Schema (MongoDB collections)

Documents; `_id` carries the former PK (client/server UUID). Status enums are
enforced in Zod (`lib/zodSchemas.js`), not a DB CHECK. Indexes are created in
`db/setup.js`.

```js
// reports collection
{ _id, name, name_lower, status /* 'safe'|'injured'|'need_help'|… */,
  lat, lng, medical_notes, phone, personal_id, created_at, updated_at,
  relay_count /* default 0 */, disaster_id, reported_by, reporter_name,
  user_type, user_id, reported_for_user_id }

// disasters collection
{ _id, type, magnitude, severity, lat, lng, radius_km,
  description, started_at, ended_at, active /* default true */ }
```

Other collections: `shelters`, `status_history` (write-only audit), `rescue_requests`,
`team_assignments`, `missing_person_cases`, `audit_logs`, `users`, `account_links`,
`safe_places`, `device_push_tokens`.

## Socket.IO Events

Shared constants in `server/src/lib/socketEvents.js`:
- `register` — client sends `{ lat, lng, userType, userId? }` on connect (`userType` = `mobile` | `web`; absent ⇒ treated as `web`). `userId` (optional) lets the server target this socket for a `loved_one_alert`.
- `stats_update` — server broadcasts every 10s + on new report (always `excludeWeb`)
- `disaster_alert` — targeted to **mobile** sockets within disaster radius only (web never receives it → never enters disaster mode). Mobile = emergency reporting; web = data collection.
- `loved_one_alert` — targeted to the **mobile** sockets of the CONFIRMED `account_links` partners of anyone inside a disaster zone. Tells a relative a loved one may be affected WITHOUT entering disaster mode (only the affected person does). Closed-app twin = `pushService.sendLovedOneAlert` (Azure NH). Orchestrated by `triggerEngine.cascadeToLovedOnes`.

## Running Locally

```bash
npm run db:up          # Start local MongoDB 7 via Docker (mirrors Cosmos v7.0)
npm run dev            # Starts server (3001) + web (5173) concurrently
cd mobile && npx expo start   # Mobile dev server
```

## State Management

No Redux/Zustand. Mobile uses local `useState` + expo-sqlite. Web uses Vue Composition API + Socket.IO singleton. Gov token stored in `sessionStorage`.

## Production Migration Paths (documented in README)

- Local MongoDB → Azure Cosmos DB for MongoDB: change `MONGODB_URI`/`MONGODB_DB` only (no code change; the driver is plain MongoDB)
- MockMeshTransport → real BLE/WiFi-Direct: swap the import in `syncService.ts`
- Static Bearer → OAuth2/OIDC: extend `authGuard.js`

## Database Notes (MongoDB)

- One collection per former table; the former TEXT PRIMARY KEY is the Mongo `_id`. Read paths map `_id` → `id` so API response shapes are unchanged.
- **Geo**: lat/lng stored as plain numbers; radius queries do a bounding-box prefilter (`idx_*_lat_lng`) + JS haversine (`lib/geo.js`). No PostGIS / 2dsphere needed.
- **No transactions**: the only cross-row atomicity (escalation, erasure) is handled per-document or as best-effort cascades — `status_history` is write-only and never read. Former FK `ON DELETE CASCADE/SET NULL` is emulated in app code (see `reportStore.eraseUserData`, `admin.cascadeUserRemoval`).
- **Uniqueness**: `users.phone` (unique), `users.personal_id` (sparse-unique — OMITTED when absent, never stored as null), `account_links (user_a_id,user_b_id)` (compound unique), `device_push_tokens.token` (unique).
- **Cosmos RU-based caveats**: connection string must keep `retrywrites=false`; no `$text` index (name search uses `$regex`).
