# Report Safe (報平安)

Disaster-status reporting system for Hong Kong. Citizens submit "I am safe / I am injured / I need help," and families and rescue authorities can retrieve information instantly—even when normal communication is broken.

**Core Invariant:** Reports are never lost. Always delivered the moment connectivity returns.

**Live:** https://report-safe-api-23235675.azurewebsites.net/

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js 22 LTS + Express 4 + Socket.IO 4 |
| Database | MongoDB 7 (Azure Cosmos DB for MongoDB in production) |
| Cache/Real-time | Redis 7 (optional — multi-instance Socket.IO + rate limiting) |
| Web Frontend | Vue 3 + Vite + Leaflet |
| Mobile | React Native 0.85.3 + Expo SDK 56 + TypeScript (strict) |
| Mobile DB | expo-sqlite (outbox queue) + expo-notifications (local disaster alerts) |
| Remote Push | Azure Notification Hubs → FCM (Android) + APNs (iOS) |
| Validation | Zod |
| Testing | Vitest |

## System Architecture

```
Mobile (Outbox SQLite) ──┐
                         ├─► Backend API (:3001)
Web (Vue 3)  ────────────┤    ├─ MongoDB / Azure Cosmos DB for MongoDB
                         ├─► ├─ Redis 7 (optional, multi-instance only)
  Gov Dashboard ─────────┘    └─ Socket.IO (real-time)
```

**3-Layer Mobile Sync:**
1. Internet → direct HTTP to backend (preferred)
2. Mesh relay → peer-to-peer (if internet down)
3. SQLite queue → survive app restart

## Deployment

- **Production URL:** https://report-safe-api-23235675.azurewebsites.net/
- **Hosting:** Azure App Service (Linux, Node 22 LTS)
- **Resource group:** `23235675`
- **App Service Plan:** `report-safe-plan-sea` (B1 tier)
- **Startup command:** `node server/src/index.js`
- **Azure account:** `kinglee.10695@gmail.com`
- **Deploy method:** Zip deploy via `az webapp deploy --type zip` (use 7-Zip to create the zip, not PowerShell `Compress-Archive`)
- **GitHub Pages:** Also deployed at `https://23235675.github.io/Report-Safe/` from `test` branch (front-end only, cannot reach API)

**Deploy steps:**
```bash
cd web && npx vite build && cd ..
"C:\Program Files\7-Zip\7z.exe" a -tzip deploy.zip package.json package-lock.json server/ shared/ web/dist/ -xr!node_modules -xr!.git
az webapp deploy --name report-safe-api-23235675 --resource-group 23235675 --src-path deploy.zip --type zip
```

**Downgrade to free tier when ready:**
```bash
az appservice plan update --name report-safe-plan-sea --resource-group 23235675 --sku F1
```

## Installation & Running

**Prerequisites:** Docker, Node 22, npm 10

```bash
# Setup
git clone https://github.com/23235675/Report-Safe.git
cd Report-Safe
npm install

# Start database (local MongoDB 7 via Docker; mirrors Cosmos v7.0)
npm run db:up
npm run db:reset                 # Schema/indexes + seed data (HK users + demo disasters)

# Run all services
npm run dev                      # Backend (:3001) + Web (:5173)

# Mobile (separate terminal)
cd mobile
npx expo start
```

Then open **http://localhost:5173** for the web app.

**Ports:**
- `:3001` — Backend API + Socket.IO
- `:5173` — Web dev server
- `:8081` — Mobile dev
- `:27017` — MongoDB (host)
- `:6379` — Redis (optional, only used for multi-instance scaling)

## Branches

- **`main`** — stable base
- **`test`** — active development; deployed to Azure and GitHub Pages

## Web UI Design

**AdminView (`/admin`) and GovView (`/gov`)** use a Word-document aesthetic:
- **Fonts:** Plus Jakarta Sans (`--font-ui`), IBM Plex Mono (`--font-mono`)
- **Chrome colours:** grey toolbars (`#e8e8e8`), grey sidebar (`#f0f0f0`), white content (`#fff`), grey borders (`#d0d0d0`)
- **Login:** centred 報 icon, "Report Safe" title, subtitle, form, sign-in button, footer note
- **AdminView:** fully monochrome — no status colours
- **GovView:** same grey/white chrome but keeps vivid status colours for rescue triage
- **Other views** (Home, Status, Account, Shelters, Report, Family) use the app's Pine design tokens

## Device Roles

### 1. Mobile (Emergency Path)
- **Citizens report their own status** from their phone: `safe` / `injured` / `need_help`
- **Disaster Mode:** When inside an active disaster radius, a full-screen gate replaces all other features until the user self-reports
- **Notifications:** Receives targeted disaster alerts via local OS notification and remote push via Azure Notification Hubs
- **Offline-first:** Writes to local SQLite queue, syncs the moment connectivity returns
- **Only mobile counts toward affected statistics**

### 2. Web (Data-Collection Path)
- **Families file proxy reports** on behalf of others who can't self-report
- **Proxy-only:** Cannot self-report, cannot submit "safe", no browser GPS, excluded from stats
- **No disaster mode, no alerts:** Web is data-collection only

### 3. Government (Gov Dashboard — `/gov`)
- Access: token-protected via the `GOV_TOKEN` env var (default `GOV-SECRET-TOKEN-2024`)
- View triage: prioritized by need (Need Help → Injured → Safe)
- Trigger disasters, full GPS + medical notes + phone

### 4. Super Admin (Admin Panel — `/admin`)
- Separate `super_admin` role with password login (scrypt-hashed) → `POST /api/admin/login`
- Full CRUD over users, reports, disasters, account links, device tokens + audit trail
- Provisioned at boot from `SUPER_ADMIN_PHONE` / `SUPER_ADMIN_PASSWORD` env vars. Local default: `+85212345678` / `12345678`

## Authentication

**Register:**
```bash
curl -X POST http://localhost:3001/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+85291234567",
    "name": "Mei Wong",
    "gender": "female",
    "personal_id": "A123456(3)",
    "privacy_consent": true,
    "user_type": "mobile"
  }'
# Returns: { user: {...}, access_token: "...", refresh_token: "...", expires_at: ... }
```

**Refresh:** exchange the one-time-use refresh token for a new pair via `POST /api/users/token/refresh`.

**Gov Token:** the `GOV_TOKEN` env var. Timing-safe compare; the server warns if the default is left in production.

**OTP:** OFF by default. Set `OTP_ENABLED=true` to require phone verification.

**HKID:** lenient by default (`HKID_STRICT=false`). Set `true` for full mod-11 check.

## Core APIs

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/users/register` | — | Create account → access + refresh tokens |
| POST | `/api/users/request-otp` | — | Request a phone OTP |
| POST | `/api/users/login` | — | Phone login → token pair |
| POST | `/api/users/token/refresh` | — | Rotate refresh token |
| GET | `/api/users/:phone/profile` | — | Look up user by phone |
| DELETE | `/api/users/:id` | Token | Account erasure (PDPO) |
| GET/PUT/DELETE | `/api/users/:id/links` | Token | Family account links |
| POST | `/api/reports` | — | Submit/relay report (idempotent) |
| GET | `/api/reports/stats` | — | Affected counts (mobile-only) |
| GET | `/api/reports/search?q=` | — | Search by name |
| GET | `/api/reports/rescue?lat&lng&radius` | Bearer | Full triage (gov) |
| GET | `/api/disasters` | — | Active disasters |
| POST | `/api/disasters/trigger` | Bearer | Trigger disaster (gov) |
| POST | `/api/devices/register` | Optional | Register push handle + location |
| POST | `/api/incidents` | Bearer | Create CFR incident (gov) |
| GET | `/api/incidents/active` | Bearer | Active incidents (gov) |
| GET | `/api/incidents/nearby?lat&lng&radius` | Token | Nearby incidents (responders) |
| POST | `/api/incidents/:id/respond` | Token | Responder status update |
| POST | `/api/incidents/:id/resolve` | Bearer | Resolve incident (gov) |
| PATCH | `/api/users/:id/responder` | Token | CFR opt-in/out |
| GET/POST | `/api/shelters` | — | List / register shelters |
| GET/POST/PUT/DELETE | `/api/safe-places` | Varies | Community safe places |
| POST | `/api/admin/login` | — | Super-admin login |
| GET/POST/PUT/DELETE | `/api/admin/*` | Admin | Super-admin CRUD + audit |

## Special Features

### Disaster-Mode Gate (Mobile Only)
Full-screen gate forces status declaration before any other feature. A single report clears all overlapping disaster zones.

### Community First Responder (999 / CPR Dispatch)
Crowdsourced emergency response — opted-in users near a medical emergency are alerted to respond with CPR before ambulance arrival.

### Never Lose Data
Mobile always writes to SQLite before network request. 3-layer sync fallback. Idempotent relay (UUID + relay_count).

### Real-Time Alerts
Disaster triggers broadcast only to mobile devices inside the affected radius via Socket.IO + push notifications.

### PDPO Compliant (HK Privacy Law)
Consent required, user erasure endpoint, HKID masked, audit logs for privileged actions.

## Testing

```bash
npm test                         # 20 files / 159 tests (needs local MongoDB)
cd mobile && npx tsc --noEmit    # strict types
cd web && npm run build          # web check
```

Test DB: isolated `reportsafe_test`. MongoDB must be up; Redis optional.

## Utility Scripts (manual, not wired into any automation)

| Script | Purpose |
|---|---|
| `scripts/backup-db.ps1` / `scripts/backup-db.sh` | Manual database backup (Windows / POSIX) |
| `server/scripts/generateData.js` | Demo data generation (`npm run db:generate` in `server/`) |
| `server/scripts/fillDatabase.js` | Alternative bulk data population (manual) |

## Configuration

`server/.env` (copy from `server/.env.example`):
```bash
PORT=3001
GOV_TOKEN=12345678
SUPER_ADMIN_PHONE=+85212345678
SUPER_ADMIN_PASSWORD=12345678
SUPER_ADMIN_NAME=Super Administrator
OTP_ENABLED=false
HKID_STRICT=false
REDIS_HOST=localhost
REDIS_PORT=6379
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=reportsafe
RATE_LIMIT_PER_MIN=300
CORS_ORIGIN=*
LOG_LEVEL=info
```

## Azure Cost Guardrails (Free Tier)

The Azure deployment is designed to sit inside the **Cosmos DB free tier** (1,000 RU/s + 25 GB) at **$0**.

1. **Free Tier must be ENABLED on the account** (`--enable-free-tier true` at creation). Verify: `az cosmosdb show -g <rg> -n <account> --query enableFreeTier` → `true`.
2. **One database with shared throughput = 1,000 RU/s manual.** Do NOT create dedicated-throughput collections.
3. **Account `totalThroughputLimit = 1000`.** Hard enforcement — don't remove this cap.

Don't remove the totalThroughputLimit = 1000.

Keep **Notification Hubs** on the **Free** tier (1M pushes/mo). Add a **Cost Management → Budget** ($1, alert at 80%) as a billing tripwire.

## Next Steps

- **Deploy:** See [DEPLOYMENT.md](DEPLOYMENT.md)
- **QA Testing:** [QA_TEST_PLAN.md](QA_TEST_PLAN.md) and [UAT_TEST_PLAN.md](UAT_TEST_PLAN.md)
- **Architecture:** [CLAUDE.md](CLAUDE.md)

---

**Built for Hong Kong disaster resilience. Always online. Never lose a report.**
