# Deployment — Environment Reference

Report Safe is a Node 20 / Express / Socket.IO server backed by MongoDB (Azure
Cosmos DB for MongoDB in production) and an optional Redis (required for
multi-instance). All hardening is application-level and runs on Azure B1 /
Cosmos Free / Notification Hubs Free.

## Core

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `MONGODB_URI` | `mongodb://localhost:27017` | Connection string (Cosmos in prod) |
| `MONGODB_DB` | `reportsafe` | Database name |
| `NODE_ENV` | — | Set `production` in prod (enables HSTS, strict CORS, warnings) |
| `REDIS_URL` / `REDIS_HOST`+`REDIS_PORT` | — | Required for >1 instance (Socket.IO adapter, rate limit, leader lock, OTP store) |

## Security

| Var | Default | Notes |
|---|---|---|
| `GOV_TOKEN` | `GOV-SECRET-TOKEN-2024` | **Set a strong secret in prod.** Built-in fallback warns at boot under `NODE_ENV=production`. |
| `TRUST_PROXY_HOPS` | `0` | **Exact** number of trusted proxies. Azure App Service / single Caddy = `1`. Wrong value lets `X-Forwarded-For` spoof `req.ip`. (H2) |
| `CORS_ORIGIN` | `*` (dev only) | Comma-separated allowlist. **Required in prod** — the server refuses to start with `*` under `NODE_ENV=production`. (L1) |
| `CONTENT_SECURITY_POLICY` | tuned for the bundled SPA | Override to tighten. (H3) |
| `ENABLE_HSTS` | on in prod | Forces `Strict-Transport-Security`; auto-on when `NODE_ENV=production`. |
| `ADMIN_IP_ALLOWLIST` | — | Comma-separated IPs allowed to reach `/api/admin/*` (returns unmasked HKID). No-op when unset. (M6) |
| `OTP_ENABLED` | `false` (dev) / `true` (prod compose) | Require a verified OTP on register/login. Stored in Redis when available. (M2) |

## Rate limiting & ingest

| Var | Default | Notes |
|---|---|---|
| `RATE_LIMIT_PER_MIN` | `300` | General `/api` ceiling (fail-closed on Redis error). (M9) |
| `REPORT_RATE_LIMIT_PER_MIN` | `600` | Separate report-ingest limiter, keyed by user, fail-open. (B2/H1) |

## Data / jobs / scale

| Var | Default | Notes |
|---|---|---|
| `SEED_DATA` | on in dev, **off in prod** | Set `true` to seed demo data in prod. (M8) |
| `SEED_USER_COUNT` | `100` | Demo users to generate when seeding (was 10,000). (M8) |
| `GEO_SCAN_CAP` | `5000` | Max docs any geo bounding-box query scans before the haversine pass. (C2) |
| `RETENTION_DAYS` | `0` (off) | PDPO purge of resolved reports older than N days; also finalizes erasure tombstones. (M1) |
| `DISASTER_POLL_INTERVAL_MS` | `30000` | Trigger-engine tick (leader-gated). |
| `MISSING_POLL_INTERVAL_MS` | `300000` | Escalation tick (leader-gated). |

## Health & observability

- `GET /api/live` — liveness (always 200).
- `GET /api/ready` — readiness; 503 if Mongo or (configured) Redis is unreachable.
- `GET /api/metrics` — request count, error rate, avg latency, active sockets.
- `GET /api/health` — legacy liveness + stats.

## Multi-instance

Background jobs (disaster trigger, escalation, retention, stats broadcast) are
leader-gated via a Redis lock (C4) — exactly one instance runs each tick. Without
Redis the app is single-instance and always "leader". Set `REDIS_URL` and run
≥2 instances (see `docker-compose.prod.yml`).

## API conventions (L7)

- **Success:** `{ "ok": true, "data": <resource|array>, "meta": { "total"?, "next_cursor"?, "limit"?, "offset"? } }`
- **Error:** `{ "error": "<message>", "code"?, "details"? }` (HTTP status carries the failure).
- **Exceptions (flat by design):** auth-token responses (`/register`, `/login`, `/token/refresh` return `access_token`/`refresh_token` at top level) and ops endpoints (`/live`, `/ready`, `/metrics`).
- **Cursor pagination:** list endpoints that support it accept `?after=<last id>` and return `meta.next_cursor`; omit `after` for legacy offset paging.

## CI

`.github/workflows/ci.yml` runs: lint (eslint), tests (Vitest + Mongo + Redis),
web build, mobile typecheck, plus a `security` job (`npm audit` high+, gitleaks)
and a CodeQL job. (B22)
