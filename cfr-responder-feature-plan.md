# Community First Responder (CFR) — Implementation Plan

**Status:** ✅ Implemented (Phases 1–3). Real CAD/AED feeds = config/import only (Phase 4).
**Author:** Engineering
**Date:** 2026-06-22
**Inspired by:** SCDF *myResponder* (Singapore) and *PulsePoint Respond* (US/Canada)

---

## 1. Goal

Add a **crowdsourced emergency-response** capability to Report Safe: when an
emergency is dispatched (a 999 call → cardiac arrest or small fire), the app
alerts nearby opted-in volunteers who can render aid — CPR, AED retrieval, fire
extinguisher — in the critical minutes **before** the ambulance / fire engine
arrives.

We do not yet have an official government CAD / 999 feed or a national AED
registry. **This plan delivers the complete logic and workflow now**, driven by
seed data and a manual "simulate dispatch" trigger, behind **one integration
seam** (`POST /api/incidents`) so that connecting the real feed later is a
configuration/import change, not a rewrite.

### Design principle

The feature is **almost entirely additive** and reuses primitives the codebase
already has. The key conceptual mapping:

| Existing concept | New concept | Behaviour |
|---|---|---|
| `disaster` (area warning) | `incident` (point dispatch) | targeted alert by radius |
| affected person (in-zone) | **responder** (nearby volunteer) | alerted, opt-in |
| `disaster_alert` (gates the app) | `responder_alert` (**non-gating**) | notify + optional screen |
| `loved_one_alert` (non-gating notify) | the closest existing analogue | reuse this pattern |

A responder alert behaves like the existing `loved_one_alert`: it notifies and
opens an optional screen, but **never** forces the recipient into disaster mode
(only the actual victim/affected person enters that). This distinction already
exists and is load-bearing in `DisasterModeContext.tsx`.

> Note: `server/src/db/setup.js` already lists `rescue_requests` and
> `team_assignments` as *dead collections* — a responder feature was scaffolded
> here once and removed. This plan fills that gap with clean names.

---

## 2. Feature catalogue (every added feature, explained)

### F1 — Incident dispatch & geofenced responder alert
**What:** When an emergency is dispatched, the server creates an `incident`
(type + location), finds opted-in responders whose live location is within
their personal travel radius, and alerts them via push (closed app) and socket
(open app). Mirrors `triggerEngine.activateDisaster`.

**Why it matters:** This is the core of myResponder/PulsePoint — the "golden
minutes" before professionals arrive. Out-of-hospital cardiac arrest survival
roughly halves for each minute without CPR.

### F2 — Smart travel radius (walk / bike / drive)
**What:** Each responder sets a max-response radius (myResponder uses 400 m walk
/ 800 m bike / 1.5 km drive). The matcher alerts a responder only if the
incident is within *their* radius.

**Why:** A driver can cover far more ground than a walker; matching to mode of
transport raises the chance a responder actually reaches the scene in time.

**How (lazy):** a single numeric field `responder_max_radius_km`. The match
query uses the widest radius among candidates for the bounding box, then
filters each responder by their own value. No transport-mode state machine.

### F3 — Accept / decline & status updates (en route → on scene)
**What:** A responder can **Accept** (en route), mark **On scene**, or
**Decline / Can't go**. Each transition writes an `incident_responses` row and
broadcasts to co-responders and the dispatcher.

**Why:** Dispatch needs to know if anyone is actually coming; co-responders need
to coordinate (PulsePoint "Assigned Responders").

### F4 — Nearest-AED locator
**What:** When a responder opens an incident, the app shows the nearest public
AEDs (Automated External Defibrillators) on the map with address / floor /
availability. Backed by an `aed_locations` registry.

**Why:** For cardiac arrest, fetching an AED fast is as important as CPR. This
is PulsePoint's NEAR / national AED registry integration.

### F5 — "Respond Together" (multi-responder coordination)
**What:** When several responders accept the same incident, each sees the
others' live positions and status on the incident map ("A: getting AED from
Block 4; B: heading to patient").

**Why:** Division of labour saves time — one fetches the AED while another
starts CPR. This is myResponder's collaborative workbench.

**Scope note:** MVP shows positions + status. In-app text chat is **deferred**
(see §3 out-of-scope) — position + status covers the coordination need without
a messaging subsystem.

### F6 — "The cavalry is coming" / incident lifecycle
**What:** Responders see the incident status; when dispatch resolves / stands
down the incident, all responders are notified and the screen closes.

**Why:** Psychological safety and clean teardown; avoids responders converging
on an already-handled scene.

**Scope note:** Live ambulance GPS tracking is **deferred** (needs the vehicle
AVL feed we don't have). The lifecycle (active → resolved/stood-down) is
implemented now.

### F7 — Responder opt-in profile & privacy tiers
**What:** Users explicitly opt in to be responders, choose skills (CPR / AED /
fire) and a travel radius. **Public** responders receive only **public-place**
incidents; **residential** incidents are restricted to verified
(`government`-role) responders.

**Why:** This is PulsePoint's privacy model — ~70 % of cardiac arrests happen at
home, but exposing residential addresses to the general public is a privacy
risk, so only vetted responders get those. Opt-in satisfies PDPO consent.

### F8 — Call 999 with GPS
**What:** A prominent "Call 999" button on the incident/response screen that
dials the emergency line; the app surfaces the precise lat/lng so the responder
can read exact coordinates to the operator.

**Why:** myResponder binds precise GPS to the call — invaluable in parks /
complex estates where a street address is ambiguous.

**Scope note:** True caller-location *transmission* to the PSAP requires telco /
CAD integration we don't have; MVP dials and **displays** the coordinates.

### F9 — Government / dispatcher console
**What:** The web gov view gains a live incident board: active incidents on a
map, with per-incident responder roster and status. Plus a **"Simulate
dispatch"** form to create an incident (the stand-in for the real 999/CAD feed).

**Why:** Dispatchers need situational awareness; the simulate button lets us
exercise the entire pipeline end-to-end before any government API exists.

### F10 — Seed & mock feed (demo without real data)
**What:** Seed a handful of HK public AEDs, mark a few seeded users as opt-in
responders near the seeded disasters, and optionally one active incident. An
optional `ENABLE_MOCK_999_FEED` periodically emits demo dispatches.

**Why:** Lets the feature be demonstrated and tested with zero external
dependencies, gated by the existing `SEED_DATA` flag.

---

## 3. Out of scope (deliberately deferred — YAGNI)

| Deferred feature | Why deferred | Add when |
|---|---|---|
| Live video / photo streaming to dispatch | Needs media storage + streaming infra absent from repo; separate project | dispatch can consume media |
| Live radio-traffic scanner | Pure content feed, zero shared logic | a radio source exists |
| Gamification (points, badges, learning center) | Engagement, not life-safety | post-MVP retention work |
| In-app responder chat | Position + status covers MVP coordination | text coordination proves necessary |
| Real-time ambulance/fire-engine GPS ("cavalry") | Requires vehicle AVL feed | AVL feed exists |
| Caller-location transmission to PSAP | Requires telco/CAD integration | CAD integration exists |

---

## 4. Data model

All collections follow the existing conventions: Mongo / Cosmos-compatible,
`_id` carries the UUID string PK (`fromDoc`/`mapId` maps `_id → id`), geo via
`(lat,lng)` bounding-box index + JS haversine (no 2dsphere), unique indexes
declared in `db/setup.js`.

### 4.1 New collection: `incidents`
A single emergency dispatch needing nearby responders.

```
_id          string  (UUID)              PK
type         string  'cardiac_arrest' | 'fire' | 'trauma' | 'other'
status       string  'active' | 'resolved' | 'stood_down'
lat          number
lng          number
address      string|null                  free-text (residential incidents)
is_public    boolean                      true = public place (general responders); false = residential (verified only)
source       string  'manual' | 'mock_feed' | 'gov_cad'   provenance / integration seam
notes        string|null                  dispatcher notes (no patient PII)
created_at   number  (epoch ms)
resolved_at  number|null
```
**Indexes:** `{status:1}`, `{lat:1,lng:1}`, `{created_at:-1}` (board sort).

### 4.2 New collection: `incident_responses`
One row per responder per incident (the former dead `team_assignments`).

```
_id          string  (UUID)              PK
incident_id  string  → incidents._id
user_id      string  → users._id
status       string  'notified' | 'enroute' | 'onscene' | 'declined' | 'stood_down'
eta_seconds  number|null                  optional self-reported / computed ETA
lat          number|null                  responder position while responding (co-responder map)
lng          number|null
updated_at   number  (epoch ms)
created_at   number
```
**Indexes:** `{incident_id:1}`, `{incident_id:1,user_id:1}` (unique — one
response row per responder per incident), `{user_id:1}`.

### 4.3 New collection: `aed_locations`
Public AED registry (seed now; gov/NEAR import later).

```
_id              string (UUID)           PK
name             string                  e.g. "MTR Central Station Concourse"
lat              number
lng              number
address          string|null
floor            string|null
available_hours  string|null             e.g. "24h" | "06:00–24:00"
source           string  'seed' | 'gov_registry' | 'citizen'
active           boolean
created_at       number
```
**Indexes:** `{lat:1,lng:1}`, `{active:1}`.

### 4.4 Modified: `users` (responder profile fields — additive, back-compatible)
Absent fields = not a responder, so existing accounts are unaffected.

```
responder_opt_in        boolean   default false
responder_skills        string[]  subset of ['cpr','aed','fire']
responder_max_radius_km  number    default 1.0  (walk≈0.4 / bike≈0.8 / drive≈1.5)
```
The existing `role` enum (`citizen|volunteer|government|super_admin`) and the
existing `allowGovOrVolunteer` guard already provide the verified-responder
tier — `is_public:false` incidents are restricted to `role:'government'`
responders. No new role is required.

---

## 5. Server architecture

### 5.1 New service: `services/incidentEngine.js`
Near-copy of `triggerEngine.activateDisaster`. Pseudocode:

```
activateIncident(payload, io):
  dedupe: suppress if an active incident of same type within ~150 m exists
          (mirrors findDuplicateActive; small radius — point events)
  insert incident (active)                       // _id = uuid
  responders = findRespondersInRadius(incident)  // see below
  broadcastResponderAlert(io, incident, responders)   // open apps (socket)
  sendResponderAlert(incident, responderDevices)      // closed apps (push)  — fire-and-forget
  prune dead device handles (same as disaster path)
  return incident

findRespondersInRadius(incident):
  candidates = users.find({ responder_opt_in:true,
                            responder_skills ∋ skillFor(incident.type) })
  // gate residential incidents to verified responders
  if !incident.is_public: candidates = candidates.filter(role == 'government')
  // join each candidate's live location from device_push_tokens (bounding box
  // sized to the MAX responder_max_radius_km, then exact haversine per responder
  // against THAT responder's own radius)
  return matched responders + their device handles
```

- **Reuses:** `boundingBox` + `haversineKm` (`lib/geo.js`, `reportStore.js`),
  the `GEO_SCAN_CAP` scan ceiling, and the fire-and-forget push pattern.
- **No polling loop** — incidents are event-driven via `POST`. An optional
  `ENABLE_MOCK_999_FEED` reuses `triggerEngine`'s mock-feed + `leaderLock`
  pattern for demos.
- `skillFor(type)`: `cardiac_arrest|trauma → 'cpr'`, `fire → 'fire'`.

### 5.2 New routes: `routes/incidents.js`

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/incidents` | `authGuard` (gov/CAD) | **Integration seam.** Create + dispatch an incident. |
| `GET /api/incidents/active` | `authGuard` | Dispatcher board: all active incidents. |
| `GET /api/incidents/:id` | `authenticate` (responder) | Incident detail + nearest AEDs + co-responder roster. |
| `POST /api/incidents/:id/respond` | `authenticate` | Set my response status (`enroute`/`onscene`/`declined`) + position. |
| `POST /api/incidents/:id/resolve` | `authGuard` (gov) | Resolve / stand down; broadcasts `incident_resolved`. |

**`POST /api/incidents` request body** (validated by `IncidentCreateSchema`):
```json
{ "type": "cardiac_arrest", "lat": 22.302, "lng": 114.177,
  "address": "Block 4, 12/F", "is_public": true, "notes": "Collapsed adult" }
```
**Response:** `201 { ok:true, data:{ id, type, status:'active', ... } }`
(or `200 { ok:true, incident:null, message:'suppressed duplicate' }`).

**`GET /api/incidents/:id` response:**
```json
{ "ok": true, "data": {
    "incident": { "id":"…","type":"cardiac_arrest","lat":…,"lng":…,"status":"active" },
    "aeds": [ { "id":"…","name":"MTR Central","lat":…,"lng":…,"distance_km":0.12 } ],
    "responders": [ { "user_id":"…","name":"…","status":"enroute","lat":…,"lng":… } ]
} }
```
(Residential incident requested by a non-verified responder → `403`.)

**`POST /api/incidents/:id/respond` body** (`IncidentRespondSchema`):
```json
{ "status": "enroute", "lat": 22.301, "lng": 114.176, "eta_seconds": 180 }
```
Upserts the `incident_responses` row, then `broadcastIncidentUpdate` to
co-responders + dispatcher.

### 5.3 New route: `routes/aed.js`
`GET /api/aed?lat&lng&radius` → nearest active AEDs (copies the shelters geo
query). Public read.

### 5.4 Modified: `routes/users.js`
Add responder opt-in. Either extend `PATCH /api/users/:id` (accept the three
responder fields) or add `PATCH /api/users/:id/responder`. Owner-or-gov scoped
(reuses `isOwnerOrGov`).

### 5.5 Modified: `lib/pushService.js`
Add `buildResponderPayload(platform, incident)` (typed `responder_alert`) and
`sendResponderAlert(incident, devices)` — both reuse `dispatchPush` verbatim
(graceful no-op when Azure NH is unconfigured, dead-handle pruning, etc.).

### 5.6 Modified: `services/realtimeService.js`
- `broadcastResponderAlert(io, incident, userIds)` — emit `incident_alert` to
  the open mobile sockets of matched responders (blend of
  `broadcastDisasterAlert`'s radius logic and `broadcastLovedOneAlert`'s
  identity targeting).
- `broadcastIncidentUpdate(io, incidentId, roomUserIds, payload)` — co-responder
  + dispatcher status updates.
- `broadcastIncidentResolved(io, incidentId)`.
- Extend the `register` socket payload to carry `isResponder` + `skills` so
  responders can be targeted without a DB round-trip per incident.

### 5.7 Modified: `lib/socketEvents.js`
Add `INCIDENT_ALERT`, `INCIDENT_UPDATE`, `INCIDENT_RESOLVED` (keep
`web/src/socket.js` + mobile constants in sync — existing convention).

### 5.8 Modified: `lib/zodSchemas.js`
`IncidentCreateSchema`, `IncidentRespondSchema`, `ResponderProfileSchema`,
`AedQuerySchema`. Reuse `latSchema`/`lngSchema`.

### 5.9 Modified: `db/setup.js`
Add the three collections to `COLLECTIONS`, declare their indexes (§4), add the
unique `{incident_id,user_id}` index. (Leave the existing `DEAD_COLLECTIONS`
drop as-is.)

### 5.10 Modified: `db/seed.js`
Seed ~10 HK public AEDs (MTR stations, malls), flip ~3 seeded users near the
seeded disaster centroids to `responder_opt_in:true` with `['cpr','aed']`, and
optionally one active demo incident. All under the existing `SEED_DATA` gate.

### 5.11 Modified: `index.js`
Mount `createIncidentsRouter(io)` at `/api/incidents` and `createAedRouter()` at
`/api/aed`. Start the optional mock feed only when `ENABLE_MOCK_999_FEED=true`.

---

## 6. Mobile architecture (React Native / Expo)

### 6.1 New screen: `IncidentResponseScreen.tsx`
Full-screen (same pattern as `DisasterModeScreen`), shown when a responder
accepts an alert:
- Map: patient pin, nearest AED pins, co-responder pins (live).
- CPR / AED quick-guidance text.
- Status buttons: **On my way / On scene / Can't go**.
- **Call 999** button (dials + displays exact coordinates).

### 6.2 Modified: `context/DisasterModeContext.tsx` (extend — do not add a 2nd socket)
The context already owns the single socket, device location, and `userId`. Add:
- subscribe to `incident_alert`, `incident_update`, `incident_resolved`;
- hold `activeIncident` + `respond(status)`;
- register `isResponder` + `skills` in the socket `register` payload.

`// ponytail: one socket — reuse the provider that already manages it`

### 6.3 Modified: `services/notificationService.ts`
- `notifyIncident(incident)` + a distinct loud `responder-alerts` Android
  channel (max importance, distinct vibration — myResponder/PulsePoint use a
  unmistakable alarm tone).
- Extend the tap listener to route `responder_alert` taps into the incident
  screen (the typed-payload routing already exists for `disaster_alert` vs
  `loved_one_alert`).

### 6.4 Modified: `api/apiClient.ts`
`getIncident(id)`, `respondToIncident(id, body)`, `getNearbyAed(lat,lng,radius)`,
`setResponderProfile(body)` + `Incident` / `Aed` / `IncidentResponse` types.

### 6.5 Modified: `screens/AccountScreen.tsx`
Responder section: opt-in toggle, skill chips (CPR / AED / Fire), travel-radius
selector (Walk 400 m / Bike 800 m / Drive 1.5 km).

### 6.6 Modified: `screens/MapScreen.tsx`
Optional AED layer toggle.

---

## 7. Web / government console (Vue)

### 7.1 Modified: `views/GovView.vue`
- Live incident board: active incidents on `LeafletMap`, per-incident responder
  roster + status (consumes `incident_update` over the existing socket).
- **"Simulate dispatch"** form → `POST /api/incidents` (stand-in for the 999/CAD
  feed).

### 7.2 Modified: `api.js` + `socket.js`
Incident endpoints + the three new socket event constants.

### 7.3 (Optional) Admin AED management
A simple CRUD list under the admin panel to add/edit AEDs before the gov
registry import exists.

---

## 8. Privacy, safety & compliance (NOT simplified away)

1. **Privacy tiers (PulsePoint model):** public responders receive only
   `is_public:true` incidents; residential incidents are restricted to
   `role:'government'` responders. Enforced server-side in
   `findRespondersInRadius` **and** `GET /api/incidents/:id` (403 otherwise) —
   never client-side only.
2. **No patient PII to responders:** incidents carry type + location + minimal
   notes; never name / HKID / phone.
3. **Opt-in consent (PDPO DPP1):** users must explicitly opt in to be alerted
   and to share their live location while responding.
4. **Scoped location sharing:** a responder's live position is shared with
   co-responders **only** while their `incident_responses.status` is
   `enroute`/`onscene` for that incident, and cleared on resolve/decline.
5. **Non-gating:** `responder_alert` must never enter disaster mode — only the
   actual victim does (reuses the existing `loved_one_alert` non-gating rule).
6. **Auth:** dispatch + resolve require the gov token; respond requires the
   user's own token (owner-scoped).

---

## 9. Government-API integration seam & demo strategy

Everything funnels through **one seam**: `POST /api/incidents` (gov-authed). A
real 999 / CAD webhook posts `{type, lat, lng, address, is_public}` and the
entire pipeline runs unchanged.

Until that exists, the same pipeline is exercised by:
- the gov console **"Simulate dispatch"** button,
- `db/seed.js` demo incident,
- optional `ENABLE_MOCK_999_FEED` poller (reuses `triggerEngine`'s mock-feed +
  `leaderLock` pattern — see the existing HKO comment at
  `triggerEngine.getMockDisasterFeeds`).

AED data: seeded now; a future `scripts/import-aed.js` bulk-loads the real
registry into `aed_locations` (`source:'gov_registry'`). Same shape, no schema
change.

**Result:** logic and workflow are 100 % complete and verifiable today; going
live with real data is a config flag + data import, not a code rewrite.

---

## 10. Configuration (new env vars — all optional, graceful defaults)

```
ENABLE_MOCK_999_FEED      'true' to emit demo dispatches (default off)
INCIDENT_DEDUPE_RADIUS_M  duplicate-suppression radius, default 150
INCIDENT_DEFAULT_RADIUS_KM default responder radius if unset, default 1.0
# (Azure NH, Redis, SEED_DATA, GEO_SCAN_CAP, GOV_TOKEN already exist and are reused)
```

---

## 11. Phased rollout

**Phase 1 — Backend + data (fully testable via curl / gov button)**
- Collections + indexes (`db/setup.js`), schemas (`zodSchemas.js`).
- `incidentEngine.js`, `routes/incidents.js`, `routes/aed.js`.
- `pushService` + `realtimeService` + `socketEvents` additions.
- Seed AEDs + responders (`db/seed.js`). Mount routers (`index.js`).
- ✅ Exit criteria: `POST /api/incidents` matches seeded responders; respond /
  resolve update state; `GET /api/aed` returns nearest AEDs.

**Phase 2 — Mobile responder flow**
- Opt-in profile (AccountScreen), incident screen, context + notification
  wiring, api client.
- ✅ Exit: a seeded responder phone receives the alert, accepts, sees AEDs +
  co-responders, calls 999.

**Phase 3 — Gov console**
- Incident board + simulate-dispatch form on `GovView.vue`.
- ✅ Exit: dispatcher creates an incident and watches responder status live.

**Phase 4 — Real data**
- Point the CAD webhook at `POST /api/incidents`; run `import-aed.js`.
- ✅ Exit: real dispatches flow end-to-end; no code change.

---

## 12. Testing

- **Unit:** `incidentEngine.findRespondersInRadius` (radius + skill + privacy
  filtering), `skillFor`, dedupe — Vitest, mirroring existing
  `triggerEngine`/`reportStore` tests.
- **Privacy assertion:** a non-verified responder must NOT match / read a
  residential (`is_public:false`) incident.
- **Push:** reuses `pushService` (already tested); add a `responder_alert`
  payload-shape assertion.
- **Manual E2E:** gov simulate-dispatch → seeded responder phone alert → accept
  → on-scene → resolve.

---

## 13. File-by-file change manifest

**New (server):** `services/incidentEngine.js`, `routes/incidents.js`,
`routes/aed.js`
**New (mobile):** `screens/IncidentResponseScreen.tsx`
**New (scripts, later):** `scripts/import-aed.js`

**Modified (server):** `db/setup.js`, `db/seed.js`, `lib/zodSchemas.js`,
`lib/pushService.js`, `lib/socketEvents.js`, `services/realtimeService.js`,
`routes/users.js`, `index.js`
**Modified (mobile):** `context/DisasterModeContext.tsx`,
`services/notificationService.ts`, `api/apiClient.ts`, `screens/AccountScreen.tsx`,
`screens/MapScreen.tsx`, `App.tsx` (route the incident screen), `i18n/messages.ts`
**Modified (web):** `views/GovView.vue`, `api.js`, `socket.js`,
`i18n/messages.js` (+ optional admin AED CRUD)

**Untouched:** disaster gate, reports flow, missing-persons, shelters,
safe-places, auth model. Blast radius is small — the feature runs in parallel on
the same geo / push / socket primitives.

---

## 14. Open decisions

1. **Responder identity** — reuse `role:'volunteer'` + opt-in fields
   *(recommended; zero new auth)* vs a distinct verified-CFR tier with separate
   vetting.
2. **AED storage** — new `aed_locations` collection *(recommended; keeps shelter
   queries clean)* vs folding AEDs into `shelters` as a new `type`.
3. **Mock feed** — ship `ENABLE_MOCK_999_FEED` for demos, or rely solely on the
   gov-console simulate button? *(Recommended: ship it, default off.)*
