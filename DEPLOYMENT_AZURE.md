# Report Safe — Azure Production Deployment

End-to-end runbook for deploying Report Safe publicly on Azure: a containerised
backend (serving the built web app) behind HTTPS, Azure Cosmos DB for MongoDB,
Redis for multi-instance scaling, and Azure Notification Hubs for remote push.

> **Architecture**
> ```
> Phone / Browser ─HTTPS─► Caddy (auto TLS) ─► server-1 ─┐
>                                              server-2 ─┴─► Azure Cosmos DB for MongoDB
>                                                            Redis (Socket.IO + rate limit)
>                                                            Azure Notification Hubs ─► FCM / APNs
> ```

---

## 0. Prerequisites

- An Azure subscription (you have this) + the Azure CLI (`az login`)
- A registered domain you can point at the server (an A record)
- Docker + Docker Compose on the host VM
- For mobile push: an **Apple Developer account** ($99/yr, for APNs) and a
  **Firebase project** (free, for FCM)

---

## 1. Azure Cosmos DB for MongoDB (managed)

Create an **Azure Cosmos DB for MongoDB** account (RU-based, API version 7.0)
**with Free Tier enabled** (`--enable-free-tier true` — set at creation only,
one per subscription). Free Tier waives the first **1,000 RU/s + 25 GB**, so the
provisioned-throughput DB below runs at **$0**; without it that throughput is
billed against the generic ~100 RU/s grant. Then:

1. **Networking** — under *Networking*, allow your app host's IP, or enable
   "Allow access from Azure portal / Azure datacenters" for a quick start.
2. **Connection string** — *Settings → Connection strings → Primary*. It
   already contains `ssl=true&retrywrites=false` (both REQUIRED for Cosmos
   RU-based). Put it in `.env.prod` as `MONGODB_URI`, and set `MONGODB_DB`
   (the database name) — see `.env.prod.example`.
3. **No manual migration** — collections and indexes auto-create on first boot
   (`server/src/db/setup.js`).

Geo queries use a lat/lng bounding-box prefilter + JS haversine (`lib/geo.js`),
so **no PostGIS/2dsphere is required**. Name search uses `$regex` (Cosmos
RU-based has no `$text` index) — the same fallback behaviour as before.

> Cost note: this replaced an oversized Azure Database for PostgreSQL. With Free
> Tier enabled, the provisioned 1,000 RU/s + 25 GB are **$0** — see README
> "Azure Cost Guardrails" for the verify step and the throughput cap that keeps
> it there. Keep the Notification Hub on the **Free** tier (1M pushes/mo).

---

## 2. Host the backend

### Option A — Single VM with Docker Compose (simplest)

```bash
# On an Ubuntu VM (Azure "Standard B2s" is plenty to start):
git clone <your-repo> report-safe && cd report-safe
cp .env.prod.example .env.prod        # then edit it (secrets, DB, domain, hub)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Caddy obtains a Let's Encrypt certificate automatically once `DOMAIN` resolves
to this VM's public IP (open ports 80 + 443 in the Network Security Group).

Scale by adding `server-3`, `server-4` … to both `docker-compose.prod.yml` and
the `reverse_proxy` upstream list in `Caddyfile`. Redis keeps Socket.IO and the
rate limiter consistent across all replicas.

### Option B — Azure Container Apps / App Service for Containers

```bash
# Build + push the image to Azure Container Registry (ACR)
az acr build --registry <yourRegistry> --image report-safe:latest \
  --file server/Dockerfile .

# Then create the App Service / Container App from that image, set the same
# env vars from .env.prod in the portal (Configuration → Application settings),
# and enable "Always On". Use Azure Front Door or the platform's managed cert
# for HTTPS instead of Caddy.
```

App Service gives you managed TLS + autoscale, but set
**ARR affinity ON** (sticky sessions) so the Socket.IO handshake stays on one
instance — the Redis adapter handles cross-instance fan-out.

---

## 3. Secrets & config

Never commit `.env.prod`. Two good options on Azure:

- **App settings** (App Service / Container Apps) — set each variable in the
  portal; they're injected as env vars.
- **Azure Key Vault** + Key Vault references for the sensitive ones
  (`GOV_TOKEN`, `DATABASE_URL`, `AZURE_NH_CONNECTION_STRING`).

Generate a strong gov token:

```bash
openssl rand -base64 48
```

---

## 4. Remote push: Azure Notification Hubs

1. **Create the hub**
   ```bash
   az notification-hub namespace create --resource-group <rg> \
     --name <namespace> --location eastasia --sku Free
   az notification-hub create --resource-group <rg> \
     --namespace-name <namespace> --name report-safe-hub --location eastasia
   ```
2. **Android (FCM v1)** — in the Firebase console create a project, then in the
   Azure hub *Settings → Google (FCM v1)* upload the service-account JSON.
3. **iOS (APNs)** — in the Apple Developer portal create an APNs auth key
   (.p8); in the hub *Settings → Apple (APNS)* add the key, Key ID, and Team ID.
4. **Connect the app** — copy the hub's
   *Access Policies → DefaultFullSharedAccessSignature* connection string into
   `AZURE_NH_CONNECTION_STRING`, and set `AZURE_NH_HUB_NAME=report-safe-hub`.

The backend (`server/src/lib/pushService.js`) direct-sends to the device handles
inside each disaster radius. Until the hub is configured the push path is a
clean no-op — local + in-app socket notifications keep working.

---

## 5. Mobile build (required for native push tokens)

Remote push needs a **dev or production build** (not Expo Go), because only a
real build exposes the native FCM/APNs handle that
`registerForRemotePush()` reads via `getDevicePushTokenAsync()`.

```bash
cd mobile
# EAS build (recommended): configure google-services.json (Android) and your
# APNs/entitlements (iOS), then:
npx eas build --platform android
npx eas build --platform ios
# Point the app at the API:
#   EXPO_PUBLIC_API_URL=https://reportsafe.example.com
```

On launch the app registers its push token + location with
`POST /api/devices/register`; the server stores it and targets it by radius.

---

## 6. Backups (PDPO + disaster resilience)

Cosmos DB for MongoDB has **automatic continuous backups** built in — enable
*Continuous (point-in-time restore)* on the account (Backup & Restore blade);
no cron job is required for the primary line of defence.

For a portable, off-Azure dump, schedule `mongodump` against `MONGODB_URI`:

- **Linux (cron):**
  ```bash
  30 2 * * *  mongodump --uri="$MONGODB_URI" --db reportsafe --archive=/mnt/backups/rs-$(date +\%F).gz --gzip
  ```
- **Windows (Task Scheduler):** run the same `mongodump` command via PowerShell.

Copy archives to an Azure Blob container so they survive loss of the app host.

---

## 7. Go-live verification

```bash
# Health (DB-backed)
curl https://reportsafe.example.com/api/health

# Auth lifecycle — register, then refresh
curl -X POST https://reportsafe.example.com/api/users/register \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+85291234567","name":"Mei Wong","personal_id":"A123456(3)","privacy_consent":true,"user_type":"mobile"}'
# → returns access_token + refresh_token + expires_at
curl -X POST https://reportsafe.example.com/api/users/token/refresh \
  -H 'Content-Type: application/json' -d '{"refresh_token":"…"}'

# Trigger a test disaster (gov token) and confirm push fan-out in logs
curl -X POST https://reportsafe.example.com/api/disasters/trigger \
  -H "Authorization: Bearer $GOV_TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"typhoon","severity":5,"lat":22.3,"lng":114.17,"radius_km":30}'
```

**Checklist**
- [ ] `GOV_TOKEN` is a strong secret (not the default)
- [ ] `CORS_ORIGIN` is your domain, not `*`
- [ ] `MONGODB_URI` set (with `retrywrites=false`) and Cosmos firewall allows the app host
- [ ] `ENABLE_HSTS=true` and HTTPS resolves with a valid cert
- [ ] `RETENTION_DAYS` set (e.g. 90) for PDPO DPP2
- [ ] Notification Hub wired to FCM + APNs; a test disaster pushes to a device
- [ ] Daily backup job runs and dumps land off-box
- [ ] `npm test` green against a staging DB before promoting

---

## 8. Operational notes

- **Logs** — structured JSON (`LOG_LEVEL`). Ship to Azure Monitor / Log
  Analytics from the container.
- **Rate limits** — `RATE_LIMIT_PER_MIN` is per-instance unless Redis is set
  (it is, here), then it's shared. Raise for a real surge.
- **Zero-downtime deploy** — `docker compose up -d --build` recreates one
  service at a time; Caddy's health checks route around a draining instance.
- **Scaling the DB** — the DB runs on provisioned shared throughput (1,000 RU/s,
  free-tier). Under sustained load you'll see HTTP 429 (the outbox retries handle
  it); raise throughput only if you intend to pay past the free 1,000. If geo
  radius queries get hot, switch the bounding-box prefilter in
  `reportStore.js`/`triggerEngine.js` to a `2dsphere` GeoJSON index (store a
  `location` point alongside lat/lng) for true server-side geo indexing.
