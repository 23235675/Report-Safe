# Report Safe (報平安)

Disaster-status reporting system for Hong Kong. Citizens submit "I am safe / I am injured / I need help," and families and rescue authorities can retrieve information instantly—even when normal communication is broken.

**Core Invariant:** Reports are never lost. Always delivered the moment connectivity returns.

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Node.js 20 + Express 4 + Socket.IO 4 |
| Database | PostgreSQL 16 |
| Cache/Real-time | Redis 7 |
| Web Frontend | Vue 3 + Vite + Leaflet |
| Mobile | React Native + Expo SDK 54 + TypeScript |
| Mobile DB | expo-sqlite (outbox queue) + expo-notifications (local disaster alerts) |
| Remote Push | Azure Notification Hubs → FCM (Android) + APNs (iOS) |
| Validation | Zod |
| Testing | Vitest |

## System Architecture

```
Mobile (Outbox SQLite) ──┐
                         ├─► Backend API (:3001)
Web (Vue 3)  ────────────┤    ├─ PostgreSQL 16
                         ├─► ├─ Redis 7
  Gov Dashboard ─────────┘    └─ Socket.IO (real-time)
```

**3-Layer Mobile Sync:**
1. Internet → direct HTTP to backend (preferred)
2. Mesh relay → peer-to-peer (if internet down)
3. SQLite queue → survive app restart

## Installation & Running

**Prerequisites:** Docker, Node 20, npm 10

```bash
# Setup
git clone https://github.com/anthropics/report-safe.git
cd report-safe
npm install

# Start database & cache
npm run db:up                    # PostgreSQL + Redis (Docker)
npm run db:reset -- --yes        # Schema + seed data (10k HK users, 3 disasters)

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
- `:5433` — PostgreSQL (host)
- `:6379` — Redis

## Device Roles

### 1. Mobile (Emergency Path)
- **Citizens report their own status** from their phone: `safe` / `injured` / `need_help`
- **Disaster Mode:** When inside an active disaster radius, a full-screen gate replaces all other features until the user self-reports. This forces every device to declare its safety before using any function.
- **Notifications:** Receives targeted disaster alerts via local OS notification (running app) **and** remote push for closed apps via Azure Notification Hubs (see "Remote Push" below). Remote push requires a dev/production build — Expo Go can't expose native handles.
- **Offline-first:** Writes to local SQLite queue, syncs the moment connectivity returns.
- **Only mobile counts toward affected statistics** — a person carrying both phone and laptop in the zone is counted once (via the phone).

### 2. Web (Data-Collection Path)
- **Families file proxy reports** on behalf of others (elderly, injured) who can't self-report.
- **Proxy-only:** Cannot self-report, cannot submit "safe" status (only the affected person can confirm safety via their phone), cannot use browser GPS.
- **Location is resolved server-side** from the affected person's own mobile report; the web report is purely identity + status information.
- **No disaster mode, no alerts:** Web is excluded from real-time notifications and never counted in official statistics.
- **Identity-based linking** (HKID + phone match) connects proxy reports to the person being reported for.

### 3. Government (Gov Dashboard)
- Access: token-protected via the `GOV_TOKEN` env var (simple `12345678` in local/testing; set a strong secret in production — the compare is timing-safe regardless)
- View triage: prioritized by need (Need Help → Injured → Safe)
- Trigger disasters (Typhoon, Rainstorm, etc.)
- Full GPS + medical notes + phone (coarse location hidden from public)

### 4. Super Admin (Admin Panel — `/admin`)
- Separate `super_admin` role with a password login (scrypt-hashed) → `POST /api/admin/login`
- Full CRUD over users, reports, disasters, account links and device tokens, plus an audit trail (every mutating action is logged)
- Provisioned at boot by `db/seedAdmin.js` from `SUPER_ADMIN_PHONE` / `SUPER_ADMIN_PASSWORD` env vars — **never hardcoded in source**. Local/testing default: `+85212345678` / `12345678`.

## Authentication

**Register:**
```bash
curl -X POST http://localhost:3001/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+85291234567",
    "name": "Mei Wong",
    "personal_id": "A123456(3)",
    "privacy_consent": true,
    "user_type": "mobile"
  }'
# Returns: { user: {...}, access_token: "..." }
```

Registration returns a short-lived **access token** plus a long-lived
**refresh token** and an `expires_at`:

```json
{ "access_token": "…", "refresh_token": "…", "expires_at": 1750000000000, "token_type": "Bearer" }
```

**Refresh:** when the access token expires (401 `token_expired`), exchange the
refresh token for a new pair. Refresh tokens **rotate** (one-time use):

```bash
curl -X POST http://localhost:3001/api/users/token/refresh \
  -H "Content-Type: application/json" \
  -d '{ "refresh_token": "…" }'
```

Lifetimes are configurable: `ACCESS_TOKEN_TTL_HOURS` (default 24) and
`REFRESH_TOKEN_TTL_DAYS` (default 30). Only token **hashes** are stored; legacy
tokens with no expiry keep working until next refresh. The web client refreshes
transparently on a 401.

**Gov Token:** the `GOV_TOKEN` env var (simple `12345678` for local/testing).
The compare is timing-safe and the value is read only from config — override with
a strong secret in production; the server warns at boot if the built-in default
is left in place while `NODE_ENV=production`.

**OTP (phone verification):** production-ready logic, **OFF by default** so test
account creation stays frictionless. Set `OTP_ENABLED=true` to require a verified
one-time passcode on register/login:

```bash
# 1) request a code (in dev the code is returned as dev_code and logged)
curl -X POST http://localhost:3001/api/users/request-otp \
  -H "Content-Type: application/json" -d '{ "phone": "+85291234567" }'
# 2) include it on register/login
curl -X POST http://localhost:3001/api/users/register \
  -H "Content-Type: application/json" \
  -d '{ "phone":"+85291234567","name":"Mei","personal_id":"A123456","privacy_consent":true,"otp":"123456" }'
```

Wire a real SMS provider in `server/src/lib/otpService.js` (`sendSms`) for
production delivery.

**HKID validation:** lenient by default (`HKID_STRICT=false`) — any value with a
letter and 6+ digits is accepted, so testers don't need a real ID. The full HK
mod-11 check-digit algorithm is implemented (`isValidHKIDChecksum`) and enforced
when `HKID_STRICT=true`.

## Special Features

### Disaster-Mode Gate (Mobile Only)
- When a mobile device is inside an active disaster radius, a **full-screen gate** replaces the entire app
- User must declare their safety (safe / injured / need_help) before accessing any other feature
- Prevents confusion and ensures every device in the zone commits to a status
- Acknowledgement persists across app restarts for the same disaster

### Never Lose Data
- Mobile always writes to SQLite before sending network request
- 3-layer sync fallback ensures delivery
- Idempotent relay (UUID + relay_count)

### Real-Time Alerts
- **Disaster triggers broadcast only to mobile devices** inside the affected radius (via Socket.IO + location tracking)
- Mobile receives a local OS notification + enters disaster-mode gate (user must self-report to proceed)
- Web clients never receive disaster alerts (even if browser is geolocalised in the zone)
- Stats update every 10s (mobile-only counts; web-submitted reports excluded)

### Remote Push — Wakes Closed Apps (Azure Notification Hubs)
- The socket alert only reaches apps that are **currently running**. A disaster can strike while the app is closed, so the backend **also** pushes a native notification via **Azure Notification Hubs** (→ FCM on Android, APNs on iOS).
- Mobile devices register their native push handle + location (`POST /api/devices/register`); a disaster trigger **direct-sends only to handles inside the radius** (`server/src/lib/pushService.js`).
- **Graceful degradation:** with no `AZURE_NH_*` env config the push path is a clean no-op — local + socket notifications still work, and all tests pass without Azure.
- Requires a dev/production mobile build (Expo Go can't expose native handles). See [DEPLOYMENT_AZURE.md](DEPLOYMENT_AZURE.md).

### PDPO Compliant (HK Privacy Law)
- Consent required at registration
- User erasure endpoint (`DELETE /api/users/:id`)
- HKID always masked in responses
- Audit logs for all privileged actions

### HK Localization
- Disaster model: HKO Typhoon Signals (T1–T10) + Rainstorm Warnings
- Seed data: 10k HK users (valid HKIDs + +852 numbers)
- 3 test disasters: T10 typhoon, Black Rainstorm, Mid-Levels landslip

### Web = Proxy-Only (Enforced)
- Families file reports on behalf of relatives without needing an app
- **Cannot report "safe"** — only the affected person (via mobile) can confirm their own safety
- **Cannot self-report** — web users cannot submit their own status
- **No browser GPS** — location resolved server-side from the affected person's mobile report
- **Never counted in stats** — web-submitted reports excluded from official affected counts (via `excludeWeb=true`)
- **Never receive disaster alerts** — web is data-collection only, not emergency reporting

### Multi-Instance Ready
- Redis syncs Socket.IO across backend instances
- Rate limiter works cross-instance
- Single-instance fallback if Redis unavailable

## Core APIs

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/users/register` | — | Create account, get access + refresh tokens |
| POST | `/api/users/request-otp` | — | Request a phone OTP (only enforced when `OTP_ENABLED=true`) |
| POST | `/api/users/login` | — | Phone login for an existing account → token pair |
| POST | `/api/users/token/refresh` | — | Exchange refresh token for a new pair |
| POST | `/api/admin/login` | — | Super-admin password login → token pair |
| GET/POST/PUT/DELETE | `/api/admin/*` | Admin | Super-admin CRUD + audit (users, reports, disasters, links, devices) |
| POST | `/api/reports` | — | Submit report |
| GET | `/api/reports/stats` | — | Affected counts (mobile-only; web proxy-reports excluded) |
| GET | `/api/reports/search?q=` | — | Search by name (coarse location) |
| GET | `/api/reports/rescue?lat&lng&radius` | Bearer | Triage (gov only) |
| POST | `/api/disasters/trigger` | Bearer | Trigger disaster (gov only) |
| POST | `/api/devices/register` | Optional | Register native push handle + location |
| GET | `/api/users/:id/links` | Token | View family links |
| DELETE | `/api/users/:id` | Token | Account erasure (DPP6) |

## Testing

```bash
npm test
```

**Coverage:** 114/114 tests passing (13 suites)
- Report store (upsert, search, stats, history)
- Status transitions + escalation priority
- PDPO erasure
- Account linking + loved-one disaster cascade
- Redis multi-instance
- Web proxy logic
- Token lifecycle (expiry + refresh rotation)
- OTP request/verify + register/login gating
- Super-admin routes (auth, CRUD, audit)
- Safe places (moderation)
- Push targeting (Azure NH payloads + radius device selection)

**Test DB:** Isolated `reportsafe_test` (dev data untouched). Postgres + Redis must be up (`npm run db:up`).

## Configuration

`server/.env` (copy from `server/.env.example` — it ships runnable test values):
```bash
PORT=3001
GOV_TOKEN=12345678                 # simple test token; strong secret in prod

# Super admin (provisioned at boot from these vars — never hardcoded in source)
SUPER_ADMIN_PHONE=+85212345678
SUPER_ADMIN_PASSWORD=12345678      # <12 chars warns at boot when NODE_ENV=production
SUPER_ADMIN_NAME=Super Administrator

# OTP phone verification — OFF by default (frictionless test signup)
OTP_ENABLED=false
OTP_TTL_SECONDS=300
OTP_LENGTH=6

# HKID validation — false = lenient (no real ID needed); true = full mod-11 check
HKID_STRICT=false

REDIS_HOST=localhost
REDIS_PORT=6379
PGHOST=localhost
PGPORT=5433
PGUSER=reportsafe
PGPASSWORD=reportsafe
PGDATABASE=reportsafe
RATE_LIMIT_PER_MIN=300
CORS_ORIGIN=*
LOG_LEVEL=info
```

> The server loads `server/.env` relative to its own location, so
> `node server/src/index.js` works from any directory (not just `cd server`).

## Next Steps

- **Deploy:** Follow [DEPLOYMENT_AZURE.md](DEPLOYMENT_AZURE.md) for the full Azure runbook (managed PostgreSQL, HTTPS via Caddy, multi-instance scaling, Notification Hubs push, backups)
- **QA Testing:** Follow [PROJECT_WORKFLOW_ASSESSMENT.md](PROJECT_WORKFLOW_ASSESSMENT.md) for testing checklist, load testing, and security audit
- **Production:** Monitoring (Azure Monitor / Log Analytics), on-call rotation, runbooks

## Support

- **Questions:** See `CLAUDE.md` (architecture) or `PRE_TEST_READINESS_ASSESSMENT.md` (security details)
- **Issues:** Report on GitHub
- **Security:** Email security@

---

**Built for Hong Kong disaster resilience. Always online. Never lose a report.**
