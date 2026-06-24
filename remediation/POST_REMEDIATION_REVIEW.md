# Report Safe — Post-Remediation Review & Production-Readiness Sign-off

**Date:** 2026-06-22 · **Branch:** `remediation/foundation-hardening`
**Reviewer pass:** full re-audit of all 38 remediation items + independent bug hunt.
**Baseline:** 143 tests / 18 files pass · mobile `tsc --noEmit` clean · `build:web` clean · eslint(server/src) 0 errors (10 intentional omit-destructuring warnings).

Sources cross-checked: [Comprehensive analysis.md](../Comprehensive%20analysis.md) (pre-remediation), [report-safe-remediation-plan.md](../report-safe-remediation-plan.md), [PROGRESS.md](PROGRESS.md), [LOG.md](LOG.md).

---

## 1. Verdict

**The implementation/build phase is complete. The system is ready for the testing phase.**

All 38 findings from the comprehensive analysis (C1–C4, H1–H7, M1–M9, L1–L8, and the B-requirement table) are genuinely implemented in code — not just checked off. I re-read every load-bearing file and confirmed the fix is present and correct. During this pass I found **two real bugs the remediation missed** and **one doc-rot**, all now fixed:

| ID | Severity | What | Fix |
|----|----------|------|-----|
| H1-2 | High (data loss) | `ReportView.vue` inline submit handler still dropped **any** 4xx (incl. 429/408) via `markSent` — the H1 fix had only reached `useOutbox.retryAll`, not this second web path | Drop on `400/422` only; everything else stays queued |
| M1-2 | Medium (integrity) | `finalizePendingErasures()` crash-recovery sweep only ran when `RETENTION_DAYS>0` (off by default) → a crash mid-erasure permanently stranded a PII-free tombstone + un-cascaded device tokens | `startRetention` now runs a leader-gated boot sweep regardless of `RETENTION_DAYS` |
| — | Trivial | root `vitest.config.mjs` comment still said "Postgres" | Corrected to MongoDB |

No other gaps from the analysis remain open.

---

## 2. Main workflow & logic (the straight-through picture)

The system has **two clients with deliberately different jobs** and one Express backend. Keeping these two responsibilities separate is the core design idea — most of the code's correctness rules fall out of it.

```
MOBILE (Expo/RN) = "emergency path"        WEB (Vue SPA) = "data-collection console"
  • self-reports own status + GPS            • PROXY-only: family reports on behalf of
  • enters disaster mode (the gate)            someone else; carries NO browser GPS
  • receives disaster + loved-one alerts     • never enters disaster mode
  • durable SQLite outbox, mesh fallback     • never counted in official stats
        │                                            │
        └──────────────── HTTP + Socket.IO ──────────┘
                              ▼
        EXPRESS  →  routes (thin)  →  services / reportStore  →  MongoDB/Cosmos
                    + Socket.IO (Redis adapter)  + leader-locked background jobs
                    + Azure Notification Hubs (closed-app push, optional)
```

### 2.1 The one critical path: a status report
1. **Client writes durably first.** Mobile `syncService.submitReport` → `outboxDb.enqueue` (SQLite, `INSERT OR IGNORE` on the client UUID) **before** any network call. Web mirrors this with `useOutbox` (localStorage). *Invariant: a report can never be lost between "user tapped send" and "we tried to deliver it."*
2. **Authenticated delivery (C1).** `POST /api/reports` requires `authenticate`. Identity (`user_id`, `reported_for_user_id`, `reporter`) is **derived from the principal**, never trusted from the body — except for the gov/admin token (trusted tooling). This is what makes "official data cannot be forged" true.
3. **Idempotent upsert (B4).** The client UUID is the Mongo `_id`. `upsertReport` tries `$inc relay_count` first; only inserts if absent; a dup-key race on insert falls back to a relay. Concurrent double-submit is safe and never overwrites status.
4. **Delivery classification (H1).** Only `400/422` (real validation failures) are permanent → dropped. `401/403/408/429/5xx`/offline are transient → **stay queued** and re-flush on reconnect. An expired token triggers one transparent refresh-and-retry.
5. **Offline fail-safe (C3).** With no internet the mock mesh transport returns **false** (no real link → never claims delivery), so the report stays `pending` and re-flushes later — instead of being marked `relayed` (terminal) and lost.

### 2.2 Disaster lifecycle
- **Activation:** seed (empty DB), `triggerEngine` polling (only with `ENABLE_MOCK_FEEDS`), or gov `POST /api/disasters/trigger`. `findDuplicateActive` (same type within 30 km) suppresses dups; the **partial-unique `(type) where active`** index (M4) is the DB backstop for the race the read-then-write can't close.
- **Fan-out:** socket `disaster_alert` to in-radius **mobile** sockets (web never gets it) + Azure NH push to closed apps in radius + a **loved-one cascade** to confirmed relatives (push for closed, socket for open, de-duplicated).
- **The gate (mobile only):** `DisasterModeContext.recompute()` flags a disaster as gating when `active && !acknowledged && (serverFlagged || withinRadius)`. Ack persists across restart; a missed socket self-heals via polling `getStats`+`getDisasters`.
- **Deactivation (B20):** gov `POST /api/disasters/:id/deactivate` → `active=false`, `disaster_deactivated` broadcast; frees the type to be re-triggered.

### 2.3 Background jobs (all leader-gated — C4)
`triggerEngine` (poll), `missingPersonService` (escalation), `retentionService` (PDPO purge + erasure sweep), and the stats broadcast timer all gate their **tick** through `runIfLeader` (Redis `SET NX PX`). Single-instance (no Redis) always leads. This is what makes the documented 2-instance prod stack safe (no duplicate disasters / double escalation / N× stats).

### 2.4 Identity, authorization & privacy tiers
- **Three credential types** (`authGuard`): static gov token (timing-safe), per-user opaque access+refresh pair (only SHA-256 hashes stored; refresh rotates with **reuse detection** — H4), super-admin scrypt password.
- **Data tiers:** public search → coarse coords + masked phone only; full coords/medical/HKID → gov `/rescue` or super-admin only; loved-one status withheld until a link is **confirmed**.
- **PDPO:** consent required at registration (DPP1); HKID masked on every user-facing response; **two-phase erasure** (M1) scrubs PII + tombstones first, then cascades + deletes (crash-safe).

---

## 3. Verification of the 38 items (spot-check evidence)

| Item | Verified at | Status |
|------|-------------|--------|
| C1 — auth + de-mass-assign report write | `routes/reports.js:79-106` (`authenticate`, identity derived, gov override) | ✅ |
| C2 — bound geo scans | `reportStore.js:282-295,434-441`, `triggerEngine.js:127-162` (`.sort().limit(GEO_SCAN_CAP)` before `toArray`) | ✅ |
| C3 — offline mesh fail-safe | `MockMeshTransport.ts:43-50` (`return false`), `outboxDb.ts:79-87` (evict delivered only) | ✅ |
| C4 — leader-elected jobs | `leaderLock.js`, `triggerEngine.js:444-454`, `missingPersonService.js:50-65`, `retentionService.js`, `realtimeService.js:80-85` | ✅ |
| H1 — outbox retry classification | `syncService.ts:29-31`, `useOutbox.js:128`, **+ `ReportView.vue:118` (fixed this pass)** | ✅ |
| H2 — trust proxy default 0 | `index.js:77-81` | ✅ |
| H3 — CSP/HSTS + httpOnly refresh cookie + access-in-memory | `httpSecurity.js:15-38`, `users.js:22-30,149,224-265`, `web/src/api.js:8-50` | ✅ |
| H4 — refresh reuse detection | `users.js:234-249` (`prev_refresh_token_hash` tripwire → family nuke), index `setup.js:149` | ✅ |
| H5 — `/stats` excludeWeb default true | `routes/reports.js:201` | ✅ |
| H6 — CI gates | `.github/workflows/ci.yml` (eslint@8, npm audit high, gitleaks, CodeQL) | ✅ |
| H7 — anchored prefix search | `reportStore.js:209-219` + `idx_users_name` | ✅ |
| M1 — two-phase erasure | `reportStore.js:469-531`, **+ boot sweep wiring (fixed this pass)** | ✅ |
| M2 — OTP in Redis (async) | `otpService.js:84-135`, awaited in `users.js:87` | ✅ |
| M3/B21 — device delete owner-scoped | `devices.js:73-83` | ✅ |
| M4/B11 — disaster dup unique index | `setup.js:105-112`, catch `triggerEngine.js:366-372` | ✅ |
| M5 — wildcard indexes dropped | `setup.js:70-72` + targeted indexes | ✅ |
| M6 — admin IP allowlist | `admin.js:104-110` | ✅ |
| M7 — cursor pagination | `admin.js:233-242` (users), `:608-627` (links) | ✅ |
| M8 — seed gated + default 100 | `db/seed.js` (SEED_DATA) | ✅ |
| M9/B23 — Redis fail-closed/open + /live,/ready,/metrics | `rateLimit.js:56-67`, `index.js:114-133` | ✅ |
| L1–L8 | CORS refuse `*` in prod, dead collections dropped, dead events removed, `mongoMap.js`, errorHandler, scripts moved, `{ok,data,meta}` envelope | ✅ |
| B19 — missing-persons CRUD | `routes/missingPersons.js` mounted `index.js:152` | ✅ |
| B20 — disaster deactivate | `routes/disasters.js:60-77` | ✅ |

The four "Can it be …?" properties from Part E of the analysis now resolve as:
- **Lost?** No on the online path (always was); offline path no longer marks un-sent reports delivered (C3); 429/NAT no longer drops (H1, both web paths now). 
- **Duplicated?** Records: no (UUID upsert). Disasters/audit: prevented by leader election (C4) + partial-unique index (M4).
- **Forged?** No — write path authenticated, identity server-derived (C1).
- **Inconsistent?** Erasure is now crash-safe and self-healing (M1 + boot sweep). Cross-document ops remain non-transactional by design (Cosmos RU) but converge.

---

## 4. Remaining gaps (known, accepted, or for later — none block testing)

These are documented limitations, not defects. They are either deliberate scope decisions or genuinely "later" work, and each has a `ponytail:` marker or comment in code.

1. **Real mesh transport is still a stub.** `MockMeshTransport` is now *safe* (keeps reports queued), but there is no actual BLE/WiFi-Direct delivery offline — reports wait for internet. Real mesh is a large native effort, explicitly out of Phase-0 scope.
2. **OTP off by default.** Login/register accept a bare phone (frictionless for testing). The OTP logic is production-ready and timing-safe; enable with `OTP_ENABLED=true` + a real SMS provider before public launch.
3. **Gov tier is a single shared static token.** No per-actor identity in the audit trail for gov actions (`audit.js` notes this). Replace with OAuth2/OIDC + RBAC for production; middleware contracts stay the same.
4. **Cross-origin web deploy caveat.** Refresh uses `credentials: 'same-origin'`; the cookie only rides along when web is served from the API origin (the default — Express serves `web/dist`). A separate-origin web host would need `credentials:'include'` + CORS `credentials:true`.
5. **Geo cap, not full pagination.** `GEO_SCAN_CAP` (5000) bounds memory/RU; the rescue view is deterministically ordered so the tail is paged, not dropped. Geohash tiling / 2dsphere is the later upgrade.
6. **Offset pagination on admin reports/devices.** Deliberate (computed-urgency sort isn't `_id`-orderable); users/links use cursors. Fine at current scale.

---

## 5. Production-readiness checklist (deploy-time)

Set these env vars before any public deployment (see `.env.prod.example`, `DEPLOYMENT.md`):

- [ ] `NODE_ENV=production`
- [ ] `GOV_TOKEN` = a strong secret (boot warns if left at the default)
- [ ] `CORS_ORIGIN` = explicit allowlist (server **refuses to start** on `*` in prod)
- [ ] `TRUST_PROXY_HOPS` = exact proxy hop count (Azure App Service / single reverse proxy = 1)
- [ ] Super-admin seed vars (`SEED_ADMIN_*`) set; `SEED_DATA` left **off** in prod
- [ ] Redis configured if running >1 instance (required for leader election + cross-instance sockets/rate-limit/OTP)
- [ ] `AZURE_NH_*` if remote push is wanted (graceful no-op otherwise)
- [ ] `RETENTION_DAYS` if PDPO auto-purge is wanted (erasure crash-recovery sweep now runs regardless)
- [ ] `OTP_ENABLED=true` + SMS provider before public launch (optional for closed testing)
- [ ] `ADMIN_IP_ALLOWLIST` for the admin surface (returns unmasked HKID)

CI already gates: eslint, full test suite (Mongo+Redis), web build, `npm audit --audit-level=high`, gitleaks, CodeQL.
