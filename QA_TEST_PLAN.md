# Report Safe — QA Test Plan

Functional, integration, security, and resilience test cases derived from **every feature** in the codebase. Use alongside [UAT_TEST_PLAN.md](UAT_TEST_PLAN.md) (role-based acceptance scenarios).

**Legend:** Priority `P0` (blocker / core invariant) · `P1` (major) · `P2` (minor/edge).
**Environments:** `LOCAL` (docker Mongo+Redis, `npm test` + `npm run dev`), `STAGING` (Azure B1 + Cosmos + Redis + NH).
**Roles:** Citizen (mobile), Family (web proxy), Volunteer, Government/EOC (gov token or `government` user), Super-admin.

How to read: each row is one case. "Expected" is the pass condition. Automated coverage is noted where a Vitest suite already asserts it (`tests/*.test.js`).

---

## A. Authentication & Session

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| A1 | P0 | Register new citizen | `POST /api/users/register` with phone, name, HKID, `privacy_consent:true` | 201; returns `user` (HKID masked) + `access_token` + `refresh_token`; refresh also set as httpOnly cookie | auth |
| A2 | P0 | Register without consent | same, `privacy_consent:false`/omitted | 400, PDPO DPP1 message | zodSchemas |
| A3 | P1 | Register duplicate HKID, new phone | register HKID already tied to another phone | 409 "already registered" | |
| A4 | P1 | Phone normalization | register with `98765432`, then `+852 9876 5432` | both resolve to `+85298765432`; second is an upsert, not a new row | zodSchemas |
| A5 | P0 | Login existing | `POST /api/users/login` phone-only | 200 + fresh token pair + cookie | auth |
| A6 | P1 | Login unknown phone | login with unregistered phone | 404 "register first" | |
| A7 | P0 | Token refresh rotates | `POST /api/users/token/refresh` (cookie or body) | 200 + new pair; old refresh no longer valid | tokenRefresh |
| A8 | P0 | Refresh **reuse detection** (H4) | refresh once (rotates), then replay the OLD refresh token | 401 `token_reuse`; the whole family invalidated (access + both refresh hashes cleared) → next refresh on any device 401s | tokenRefresh |
| A9 | P1 | Refresh expired | present a refresh token past TTL | 401 `refresh_expired` | |
| A10 | P0 | Access-token expiry auto-refresh | call an authed endpoint with an expired access token (client) | client transparently refreshes once and replays; user sees no error | tokenRefresh |
| A11 | P0 | Gov static token | call `/api/reports/rescue` with `Bearer <GOV_TOKEN>` | 200; timing-safe compare | auth |
| A12 | P1 | Gov token default warning | boot with `NODE_ENV=production` and default GOV_TOKEN | warning logged `GOV_TOKEN is still the built-in default` | |
| A13 | P0 | Super-admin login | `POST /api/admin/login` phone+password (scrypt) | 200 + token; wrong password → 401 "Invalid credentials" | adminRoutes |
| A14 | P1 | Admin login phone formats | login with bare 8 digits and full +852 | both succeed (normalized) | |
| A15 | P1 | OTP enforced (when on) | `OTP_ENABLED=true`; register/login without `otp` | 401 `otp_required`; with valid code → success; code is one-time, attempt-limited (5), expiry-checked | otp |
| A16 | P2 | OTP cross-instance (M2) | with Redis: request OTP on node A, verify on node B | succeeds (Redis-backed store) | redis |

## B. Report submission — core invariants

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| B1 | P0 | Self report (mobile) | authed `POST /api/reports` `user_type:mobile` with lat/lng/status | 201; stored with `user_id` = authenticated user, `reported_by:self` | reportsProxy |
| B2 | P0 | **Unauthenticated write blocked (C1)** | `POST /api/reports` with no token | 401 | reportsProxy |
| B3 | P0 | **Mass-assignment blocked (C1)** | authed non-gov submit body with `user_id`, `reported_for_user_id`, `status:'safe'` for someone else | server ignores body identity fields; derives them from the principal | reportsProxy |
| B4 | P0 | Gov override allowed | gov-token submit with explicit `user_id`/`status` | accepted as-is (trusted tooling) | |
| B5 | P0 | Idempotent relay (B4) | submit same id twice | second is a relay: `relay_count++`, status/identity NOT overwritten | reportStore |
| B6 | P0 | Concurrent double-submit | fire two identical-id submits in parallel | exactly one insert; the loser becomes a relay (dup-key safe) | reportStore |
| B7 | P1 | Missing coordinates (mobile) | mobile submit with no lat/lng | 400 "lat and lng are required" | |
| B8 | P1 | Invalid HKID (strict) | `HKID_STRICT=true`, submit bad checksum personal_id | 400 invalid HKID | zodSchemas |
| B9 | P1 | Validation 422/400 → permanent drop | submit malformed body / web "safe" | 400/422; client drops from outbox (won't retry) | syncService |

## C. Web proxy rules (A6 — data-collection console)

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| C1 | P0 | Proxy report (web) | authed `user_type:web` report about another person | 201; `reported_by:family`, `reporter_name` from principal, location resolved from the subject's own report or disaster centre | reportsProxy |
| C2 | P0 | Web cannot mark "safe" | web report `status:'safe'` | 422 (only the affected person confirms safety via mobile) | reportsProxy |
| C3 | P1 | Web no-location resolution | web report with no resolvable subject location and no disaster_id | 422 "no known location yet" | reportsProxy |
| C4 | P0 | Web excluded from official stats (H5/B7) | submit a web report, read `GET /api/reports/stats` (default) | web report NOT counted; `?exclude_web=false` includes it | reportsProxy |
| C5 | P0 | Web never triggers alerts | web report submission | no `broadcastStats`/disaster broadcast fired for web | |

## D. Offline outbox & sync (never-lose)

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| D1 | P0 | Outbox-first | submit while online | report enqueued in SQLite/localStorage BEFORE the network call | syncService |
| D2 | P0 | **Offline stays pending (C3)** | submit with no connectivity (mesh path) | `sendToPeer` returns false → report stays `pending`, NOT marked relayed/lost | syncService |
| D3 | P0 | Reconnect flush | go offline→online | `connectivityWatcher` rising edge flushes the whole pending queue | syncService |
| D4 | P0 | **429 stays queued (H1)** | server returns 429 to a submit | report stays `pending` (transient), retries later — NOT dropped | syncService |
| D5 | P0 | **401/403/408/5xx stay queued (H1)** | server returns each | stays queued (401 token_expired also triggers refresh+retry) | syncService |
| D6 | P0 | 400/422 dropped (H1) | server returns 400/422 | dropped from outbox (permanent), user shown the real reason | syncService |
| D7 | P0 | **Web ReportView inline path (H1-2, this fix)** | logged-in web submit that returns 429/408 | report stays queued (warn shown), NOT `markSent`-dropped | manual |
| D8 | P1 | App restart durability | enqueue, kill app, relaunch | pending report survives and re-attempts | manual |
| D9 | P2 | Outbox cap | enqueue >200 delivered + some pending | only delivered rows evicted; pending never dropped | manual |
| D10 | P2 | localStorage unavailable (web) | private mode | falls back to in-memory mirror; warns reports won't survive reload | manual |

## E. Disasters

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| E1 | P0 | Manual trigger (gov) | `POST /api/disasters/trigger` gov token | 201 + disaster; audit-logged | triggerEngine |
| E2 | P1 | Trigger requires gov | trigger with citizen/no token | 401 | |
| E3 | P0 | Duplicate suppression (M4) | trigger same type within 30 km twice | second returns "suppressed" (no second active record) | triggerEngine |
| E4 | P0 | Duplicate race backstop (M4) | two concurrent triggers same type | partial-unique index → only one active; the 11000 loser returns the existing | triggerEngine |
| E5 | P0 | Deactivate (B20) | `POST /api/disasters/:id/deactivate` gov | 200; `active:false`+`ended_at`; `disaster_deactivated` broadcast; type re-triggerable | |
| E6 | P1 | Deactivate non-existent/inactive | deactivate a missing/already-inactive id | 404 | |
| E7 | P1 | GET active disasters | `GET /api/disasters` | only `active:true`, newest first | |
| E8 | P1 | HKO severity mapping | trigger typhoon severity 4 | description carries HKO signal name (e.g. T9) | triggerEngine |
| E9 | P1 | Threshold gating | feed signal magnitude<6 and severity<3 | not triggered | triggerEngine |

## F. Disaster mode gate (mobile only — B8/B9)

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| F1 | P0 | Gate opens in-zone | disaster within radius of mobile location, not acknowledged | gate shows (recompute flags it) | manual |
| F2 | P0 | Web never gates | web client inside radius | never enters disaster mode; no `disaster_alert` received | manual |
| F3 | P0 | Ack persists across restart | acknowledge, relaunch app | gate stays dismissed for that disaster (`rs_ack_disasters`) | manual |
| F4 | P0 | Self-heal via poll | miss the socket alert; let `refresh()` poll | gate still opens from `getStats`+`getDisasters` | manual |
| F5 | P1 | `acknowledgeAllInZone` | overlapping zones stack many disasters; report once | a single safety report clears the gate for all in-zone disasters | severity/manual |
| F6 | P1 | Severity sort with string severity | disasters with severity `"high"` and `3` | sorted by `severityRank` (no NaN mis-bucket) | severity |
| F7 | P1 | Deactivation clears gate | gov deactivates the gating disaster | mobile clears on next poll; web clears via `disaster_deactivated` | manual |

## G. Notifications & loved-one cascade

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| G1 | P0 | Socket alert to in-radius mobile only | trigger disaster | only mobile sockets in radius get `disaster_alert`; web excluded | lovedOneCascade |
| G2 | P0 | Loved-one cascade (confirmed only) | affected user has a CONFIRMED link; trigger | partner gets `loved_one_alert` (open app) / push (closed); pending links get nothing | lovedOneCascade |
| G3 | P1 | De-dup direct vs cascade | relative is themselves in-zone | not double-notified (excluded from cascade) | lovedOneCascade |
| G4 | P0 | Push graceful no-op (B15) | `AZURE_NH_*` unset | push skipped cleanly, activation succeeds | push |
| G5 | P1 | Dead handle pruning | push returns 410/404 | dead device tokens deleted | push |
| G6 | P2 | Local notification payload | tap a local disaster banner | carries `disasterId`+`type`, routes into the gate | manual |
| G7 | P1 | Stats broadcast | new mobile report / 10s timer | `stats_update` to all clients, always excludeWeb; timer leader-gated | |

## H. Shelters

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| H1 | P1 | List by radius | `GET /api/shelters?lat&lng&radius` | active shelters within radius, distance-sorted; scan bounded (C2) | safePlaces? |
| H2 | P1 | Create (gov/volunteer) | `POST /api/shelters` with allowGovOrVolunteer token | 201; audit-logged | |
| H3 | P0 | Create unauthorized | citizen/no token | 401/403 | |
| H4 | P1 | Update / soft-delete | `PUT` / `DELETE /:id` | DELETE sets `active:false` (soft) | |
| H5 | P2 | Unknown disaster_id filter | shelter create with bad disaster_id | handled per route rules | |

## I. Safe places (citizen-submitted, moderated)

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| I1 | P1 | Submit (authed user) | `POST /api/safe-places` citizen | 201; `status:pending` | safePlaces |
| I2 | P0 | Submit requires account | no/gov-only token | 403 "user account required" | safePlaces |
| I3 | P0 | Public list shows approved only | `GET /api/safe-places` | only `approved`+`active`; pending/rejected hidden; no submitter PII | safePlaces |
| I4 | P1 | Moderation queue | `GET /api/safe-places/pending` gov/volunteer | pending list with submitter name/phone | safePlaces |
| I5 | P1 | Approve/reject | `PUT /:id/status` gov/volunteer | status set, reviewer recorded; re-review of non-pending → 404 | safePlaces |
| I6 | P1 | Unknown disaster_id | submit with bad disaster_id | 400 | safePlaces |

## J. Missing-person cases (B19)

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| J1 | P1 | Open case | `POST /api/missing-persons` gov/volunteer | 201; `missing_alert` socket fires | phase3 |
| J2 | P0 | Citizen cannot manage | citizen token | 403 | phase3 |
| J3 | P1 | List / filter | `GET /api/missing-persons?status=` | default active+investigating; filter works | phase3 |
| J4 | P1 | Update / close | `PUT` / `DELETE /:id` | status updated; DELETE soft-closes (`closed`) | phase3 |

## K. Account links ("loved ones")

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| K1 | P0 | Request link | `POST /api/users/:id/links` `target_phone` | 201 pending; owner-scoped | |
| K2 | P0 | Confirm link (recipient) | `PUT /:id/links/:link_id` by user_b | 200 confirmed | |
| K3 | P0 | Privacy before consent | list links while pending | partner's report status withheld until confirmed | |
| K4 | P1 | Cannot link to self / unknown | link to own id / unknown phone | 400 / 404 | |
| K5 | P0 | Ownership enforced (IDOR) | user A operates on user B's links | 403 | devicesAuth/manual |
| K6 | P2 | Link rate limit | >50 link requests/hour | 429 | |

## L. Devices (push registry)

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| L1 | P1 | Register (optional auth) | `POST /api/devices/register` | 201; upsert by token; user_id linked when Bearer present | devicesAuth |
| L2 | P0 | **Delete owner-scoped (M3/B21)** | `DELETE /api/devices/:token` as another user | 403; only owner or gov may unregister | devicesAuth |
| L3 | P1 | Delete idempotent | delete a non-existent token (as authed) | 200 ok | devicesAuth |

## M. Admin console

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| M1 | P0 | All admin routes require super_admin | any `/api/admin/*` (except login) without admin token | 401/403 | adminRoutes |
| M2 | P1 | CRUD users/reports/disasters/links/devices | each create/update/delete | succeeds; every mutation writes an `audit_logs` row | adminRoutes |
| M3 | P0 | Self-protection | demote own super_admin / delete own account | 400 (blocked) | adminRoutes |
| M4 | P0 | Passwordless super_admin blocked | create/promote super_admin without password | 400 | adminRoutes |
| M5 | P1 | Cursor pagination (M7) | `GET /api/admin/users?after=` and `/links?after=` | `_id`-ordered pages, `next_cursor` returned, no overlap | adminRoutes |
| M6 | P1 | Offset pagination | users/links without `?after`; reports/devices | legacy offset path works | adminRoutes |
| M7 | P1 | Empty-string field guard | admin form submits `role:""` | field NOT overwritten (blank→skip) | adminRoutes |
| M8 | P1 | Invalid enum | bad role/status/user_type | clean 400 | adminRoutes |
| M9 | P2 | IP allowlist (M6) | set `ADMIN_IP_ALLOWLIST`; request from outside | 403; unset → no-op | |
| M10 | P1 | HKID unmasked here only | admin user list | full HKID returned (admin only); masked everywhere else | |

## N. PDPO / data protection

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| N1 | P0 | HKID masked on user responses | profile/login/register | `A•••••(7)` form; never full | |
| N2 | P0 | Coarse location for public (B5) | `GET /api/reports/search` | coarse (0.01°) coords + masked phone only | reportStore |
| N3 | P0 | Erasure scrubs + cascades (M1) | `DELETE /api/users/:id` owner/gov | reports PII nulled (rows kept for counts); user/links/devices/safe_places removed | reportStore/phase3 |
| N4 | P0 | **Erasure crash recovery (M1-2, this fix)** | simulate crash after phase-1 tombstone; restart server | boot sweep `finalizePendingErasures` finishes the cascade + deletes the shell, regardless of RETENTION_DAYS | manual |
| N5 | P1 | Retention purge (opt-in) | `RETENTION_DAYS>0`; resolved reports older than cutoff | purged (safe/rescued/deceased only); unresolved never auto-purged | manual |
| N6 | P0 | Erasure ownership | erase another user's account as non-owner/non-gov | 403 | |

## O. Security hardening

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| O1 | P0 | General /api rate limit | exceed `RATE_LIMIT_PER_MIN` | 429 + `Retry-After`; ingest POST /reports exempt (own user-keyed limiter) | hardening |
| O2 | P0 | Redis fail-closed (general) (M9) | drop Redis mid-request on the /api limiter | 429 (abuse protection not silently disabled) | redis |
| O3 | P0 | Redis fail-open (ingest) (M9) | drop Redis on report ingest | request passes (losing a report is worse than skipping a check) | redis |
| O4 | P0 | Trust proxy default 0 (H2) | no `TRUST_PROXY_HOPS`; spoof `X-Forwarded-For` | `req.ip` not spoofable | hardening |
| O5 | P0 | CSP/HSTS headers (H3) | any response | CSP present (overridable); HSTS in prod | hardening |
| O6 | P0 | CORS refuse `*` in prod (L1) | boot prod with `CORS_ORIGIN=*` | server refuses to start | |
| O7 | P1 | Web token storage (H3) | inspect web storage after login | access token in memory only; refresh in httpOnly cookie; no tokens in localStorage | manual |
| O8 | P1 | No stack leak (L6) | force a thrown error | JSON `{ok:false,error:{code,reqId}}`; stack only in server log | |
| O9 | P1 | Error envelope + reqId | any 500 | carries `reqId` correlating to the structured log | |

## P. Observability & health

| ID | P | Case | Steps | Expected |
|----|---|------|-------|----------|
| P1 | P0 | `/api/live` | GET | always 200 `{status:live}` |
| P2 | P0 | `/api/ready` | GET with Mongo (and Redis) up/down | 200 when deps ok; 503 when Mongo or configured Redis unreachable |
| P3 | P1 | `/api/metrics` | GET | request count / error rate / latency / active sockets |
| P4 | P1 | `/api/health` | GET | 200 + stats (legacy); 500 on DB error |
| P5 | P1 | Health/metrics exempt from limiter | hammer `/api/health` | never 429 |

## Q. Multi-instance / leader election (C4)

| ID | P | Case | Steps | Expected |
|----|---|------|-------|----------|
| Q1 | P0 | Single disaster across instances | 2 instances + Redis; trigger via polling | only the leader activates; no duplicate disaster/escalation/retention |
| Q2 | P0 | Single stats broadcast | 2 instances | periodic `stats_update` fires once cluster-wide (event-driven per-instance is fine) |
| Q3 | P1 | Leader failover | kill the leader | lock TTL expires; another instance takes over within ~1 interval |
| Q4 | P1 | No-Redis single instance | no Redis | every tick "leads" (no coordination needed) |

## R. i18n & cross-platform

| ID | P | Case | Steps | Expected |
|----|---|------|-------|----------|
| R1 | P1 | Language toggle (web + mobile) | switch EN ↔ Traditional Chinese | all strings localized; persists |
| R2 | P2 | Status/severity labels localized | view statuses + severities | correct localized labels/colours |
| R3 | P1 | HKID validation parity | validate HKID on web, mobile, server | same accept/reject behavior (lenient default / strict when `HKID_STRICT`) | 

## S. Build / CI / regression gates

| ID | P | Case | Expected |
|----|---|------|----------|
| S1 | P0 | `npm test` | 143/143 pass (18 files) against docker Mongo+Redis |
| S2 | P0 | `npm run build:web` | clean production build |
| S3 | P0 | mobile `tsc --noEmit` | no type errors |
| S4 | P1 | eslint server/src (eslint@8, flat-config off) | 0 errors |
| S5 | P1 | `npm audit --audit-level=high --omit=dev` | no high/critical |
| S6 | P1 | gitleaks + CodeQL | no leaked secrets / no high SAST findings |

## T. Community First Responder — CFR / 999 / CPR dispatch

| ID | P | Case | Steps | Expected | Auto |
|----|---|------|-------|----------|------|
| T1 | P1 | Opt in as responder | `PATCH /api/users/:id/responder` `responder_opt_in:true` + skills + `responder_max_radius_km` | 200; opt-in, skills, radius stored; opting out clears skills | incidentRoutes |
| T2 | P0 | Nearby feed consent-gated (PDPO) | `GET /api/incidents/nearby` as a user who has **not** opted in | 200 + **empty** list (non-responders never receive the feed) | incidentRoutes |
| T3 | P0 | Nearby feed requires user auth | call `/nearby` with gov token / no token | 403 "Only a responder (user)" / 401 | incidentRoutes |
| T4 | P1 | Nearby = active + in-radius only | seed active + resolved incidents; opted-in user nearby | only `active` within radius, distance-sorted; radius capped at 20 km; missing lat/lng → 400 | incidentRoutes |
| T5 | P0 | Residential incident privacy gate | `is_public:false` incident; opted-in **non-gov** responder vs gov/`government` user | hidden from public responder; visible only to verified (gov) responders | incidentRoutes |
| T6 | P0 | No PII in the feed | inspect `/nearby` payload | only `id/type/lat/lng/is_public/status/created_at/distance_km` — never names, phones, HKID | incidentRoutes |
| T7 | P1 | Dispatch an incident (gov/CAD) | `POST /api/incidents` gov token | 201; audit-logged; broadcast to in-radius responders | incidentRoutes/incidentEngine |
| T8 | P1 | Respond sets status | `POST /api/incidents/:id/respond` `enroute`/`onscene`/`declined` | status recorded; live position shared **only** while `enroute`/`onscene`; `declined` dismisses | incidentRoutes |
| T9 | P1 | Incident detail + AEDs + roster | `GET /api/incidents/:id` (responder) | detail + nearest active AEDs + co-responder roster; positions only for actively-responding peers | incidentRoutes |
| T10 | P1 | Resolve (gov) | `POST /api/incidents/:id/resolve` gov | incident closed; drops out of the `/nearby` feed | incidentRoutes |
| T11 | P2 | Mobile Home live map | open Home as opted-in responder | live map renders active-incident + nearby-need pins (+ shelter pins in a disaster zone); expand → full-screen modal | manual |
| T12 | P2 | ShelterScreen manager queue | open Shelters as gov/volunteer | toggle between shelter info and the safe-place request queue; citizens see info only | manual |

---

### Suggested execution order
1. **S1–S6** (gates green) → 2. **A, B, C, D** (auth + the core never-lose/cannot-forge invariants) → 3. **E, F, G** (disaster path) → 4. **H–N, T** (feature breadth + PDPO + CFR) → 5. **O–R** (security/ops/i18n) → 6. **Q** (only when deploying >1 instance).
