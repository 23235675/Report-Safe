# Report Safe — User Acceptance Test (UAT) Plan

End-to-end, role-based acceptance scenarios written from the **user's** point of view. These validate that the system delivers the product's two promises in realistic conditions: **a report is never lost** and **official data cannot be forged**. Pair with [QA_TEST_PLAN.md](QA_TEST_PLAN.md) for the technical/edge cases.

**Personas**
- **Citizen** — a person in the affected area, using the **mobile app**, reports their own status.
- **Family** — a relative outside the area, using the **web console**, reports on a citizen's behalf (proxy).
- **Volunteer** — a vetted helper who manages shelters and moderates safe places.
- **Government / EOC operator** — runs disaster triage and lifecycle (gov token or `government` user).
- **Super-admin** — platform operator managing all data.

**How to record a result:** Pass / Fail + notes + screenshot. A scenario passes only if **every** acceptance criterion (AC) is met.

---

## Persona 1 — Citizen (mobile)

### UAT-C1 — First-time onboarding & account
**Pre:** fresh install. **Steps:** open app → create account with name, phone, HKID → accept privacy consent.
- AC1 Cannot complete registration without ticking privacy consent.
- AC2 After registration the app is signed in (no separate login needed).
- AC3 The displayed profile shows the HKID **masked** (e.g. `A•••••(7)`), never in full.

### UAT-C2 — Report "I'm safe" during a disaster
**Pre:** signed in, a disaster is active covering the user's location. **Steps:** app shows the disaster-mode gate → tap a status (e.g. *Safe*) → submit.
- AC1 The gate appears automatically when the user is in an affected zone (mobile only).
- AC2 Submitting succeeds with a confirmation + reference id; the gate is dismissed.
- AC3 The report is attributed to **this** user automatically — the user never types who they are.
- AC4 If the user is stacked into several overlapping zones, one safety report clears the gate for all of them.

### UAT-C3 — Report with no GPS fix (the disaster case)
**Pre:** location services slow/unavailable. **Steps:** submit a status.
- AC1 The submit does **not** hang forever on a spinner — it proceeds within a few seconds using last-known / HK-centre fallback.
- AC2 The report is still delivered or queued (never silently stuck).

### UAT-C4 — Report while offline, then reconnect (NEVER LOSE)
**Pre:** put the phone in airplane mode. **Steps:** submit a status → confirm it's queued → re-enable internet.
- AC1 The app accepts the report and shows it as **queued/pending** (not failed).
- AC2 The report is **not** silently marked delivered while offline.
- AC3 On reconnect the queued report is delivered automatically without the user resubmitting.
- AC4 Killing and relaunching the app while offline preserves the queued report.

### UAT-C5 — Surge / rate-limit does not lose a report
**Pre:** simulate the server returning "too busy" (429) on submit. **Steps:** submit.
- AC1 The user sees a "queued, will retry" message — **not** a permanent failure.
- AC2 The report stays in the outbox and is delivered on a later attempt.

### UAT-C6 — Add a loved one
**Steps:** add a loved one by phone → the other person confirms.
- AC1 A request is created as *pending*; the loved one's status is hidden until they confirm.
- AC2 After confirmation, the citizen can see the loved one's latest status + coarse location.
- AC3 If the loved one is later in a disaster zone, the citizen receives a "loved one may be affected" alert (without the citizen entering disaster mode themselves).

### UAT-C7 — Delete my account (PDPO erasure)
**Steps:** request account deletion.
- AC1 The account and its links/devices/safe-place submissions are removed.
- AC2 Aggregate counts remain consistent (the user's reports are anonymized, not deleted).
- AC3 The deleted user's device no longer receives pushes.

---

## Persona 2 — Family member (web proxy)

### UAT-F1 — Report on behalf of a relative
**Pre:** signed in on the web console. **Steps:** open Report → enter the relative's name/HKID/phone, choose a status (Injured/Need help/Missing), submit.
- AC1 The web form offers proxy statuses only — **"Safe" is not available** (only the person can confirm their own safety).
- AC2 The submission requires being signed in; an anonymous browser cannot file.
- AC3 No browser GPS is requested or required; the system resolves the relative's location.
- AC4 A reference id is shown on success.

### UAT-F2 — Search for a loved one
**Steps:** search by name or phone.
- AC1 Results show name, status, **coarse** location, and a **masked** phone (last 4 digits) — never exact GPS, medical notes, or HKID.
- AC2 A registered person with no report yet still appears (status shown as "no report yet").

### UAT-F3 — Web does not distort official numbers
**Steps:** file a proxy report, then view the public stats / dashboard counts.
- AC1 The web proxy report is **not** counted in the official affected totals by default.
- AC2 The web user never enters disaster mode, even if located inside a zone.

### UAT-F4 — Offline / flaky connection on web
**Steps:** file a report with the network down, then restore it.
- AC1 The report is queued locally and retried; a transient failure (offline/429) does not drop it.
- AC2 Only a genuine validation rejection (bad data) is dropped, with a clear reason.

---

## Persona 3 — Volunteer

### UAT-V1 — Manage shelters
**Pre:** signed in as a volunteer. **Steps:** add a shelter, edit its capacity, deactivate it.
- AC1 Create/edit/deactivate succeed; deactivate hides it from the public list (soft delete).
- AC2 A citizen account cannot create or edit shelters.

### UAT-V2 — Moderate citizen safe-place submissions
**Steps:** open the moderation queue → approve one, reject another.
- AC1 Pending submissions are visible with the submitter's name/phone.
- AC2 Approved places appear on the public map; rejected/pending do not.
- AC3 A citizen cannot see the moderation queue.

---

## Persona 4 — Government / EOC operator

### UAT-G1 — Trigger a disaster
**Steps:** trigger a disaster (type, location, radius, severity) with the gov credential.
- AC1 The disaster is created and broadcast; in-zone mobile users enter disaster mode.
- AC2 Triggering the **same** disaster type in the same area again is suppressed (no duplicate).
- AC3 The action is recorded in the audit trail.

### UAT-G2 — Rescue triage view
**Steps:** open the rescue view for the affected area.
- AC1 Shows **full** coordinates, medical notes, and identity needed for rescue — available only with the gov credential.
- AC2 Results are ordered by triage priority (need-help/missing first), then distance.
- AC3 An escalated "silent" need-help case is never ranked below a less-urgent responsive case.

### UAT-G3 — Escalation of silent cases
**Pre:** a *need_help* report goes without follow-up. **Steps:** wait past the thresholds (or use shortened test thresholds).
- AC1 A silent *need_help* escalates to *awaiting_response*, then to *potentially_missing*.
- AC2 Escalation updates the dashboards; it never lowers a case's rescue priority.

### UAT-G4 — Open and manage a missing-person case
**Steps:** open a case (optionally from a report), update status, close it.
- AC1 Gov/volunteer can open/update/close cases; citizens cannot.
- AC2 Opening a case raises a missing-person alert to connected dashboards.

### UAT-G5 — End a disaster
**Steps:** deactivate an active disaster.
- AC1 The disaster is marked ended; clients clear it (mobile on next refresh, web immediately).
- AC2 The same type can be triggered again afterward.

### UAT-G6 — Forgery resistance (the core security promise)
**Steps:** attempt to submit reports from an **unauthenticated** client, and attempt to submit reports attributing them to **another** person/HKID as a normal user.
- AC1 Unauthenticated report submission is rejected.
- AC2 A normal user cannot set another person's identity/status — the server attributes the report to the actual submitter.
- AC3 The official affected counts and rescue triage cannot be poisoned by anonymous input.

---

## Persona 5 — Super-admin

### UAT-S1 — Data management with accountability
**Steps:** sign in to the admin console; create/edit/delete a user, report, disaster, link, device.
- AC1 Every mutating action appears in the audit log.
- AC2 The admin cannot demote their own super-admin role or delete their own account.
- AC3 Creating/promoting a super-admin without a password is refused.

### UAT-S2 — Large-list navigation
**Steps:** page through users and links on a large dataset.
- AC1 Pagination is stable (no skipped/duplicated rows across pages).
- AC2 Filters (role, status, search) work and totals are correct.

### UAT-S3 — Restricted exposure of identifiers
**Pre:** `ADMIN_IP_ALLOWLIST` configured. **Steps:** access the admin API from an allowlisted and a non-allowlisted address.
- AC1 Non-allowlisted access is refused.
- AC2 Full (unmasked) HKID is visible only in the admin console, never on citizen/family-facing responses.

---

## Cross-cutting end-to-end scenarios

### UAT-E2E-1 — Full disaster lifecycle (multi-persona)
1. EOC triggers a typhoon over Kowloon. → in-zone **citizens** get the gate; **web** users do not.
2. A citizen reports *need_help* (queued offline, then delivered on reconnect).
3. The citizen's confirmed **family** member receives a "loved one affected" alert and also files a proxy *injured* note.
4. EOC opens the **rescue view**: sees the citizen with full coords + medical; web proxy note is visible to gov but excluded from official counts.
5. The need_help goes silent → escalates to *potentially_missing*; EOC opens a **missing-person case**.
6. Rescue completes; EOC marks the report *rescued* and **deactivates** the disaster.
- **Overall AC:** every step works in order; no report is lost at any hop; the official counts reflect only mobile self-reports; all gov actions are audited.

### UAT-E2E-2 — Resilience under partial outage
1. Take **Redis** down mid-session. → general API stays protected (fail-closed 429s under abuse), but **report ingest still accepts** reports (fail-open).
2. Take **MongoDB** unreachable. → `/api/ready` returns 503 (orchestrator can react); `/api/live` stays 200.
3. Restore both.
- **Overall AC:** no crash; reports submitted during the window are queued and eventually delivered; health endpoints reflect reality.

### UAT-E2E-3 — Multi-instance correctness (deploy-time, ≥2 instances + Redis)
1. Run 2 backend instances behind a load balancer.
2. Trigger disasters, let escalation/retention run, observe stats broadcasts.
- **Overall AC:** exactly one disaster per incident, no duplicate escalations or retention deletes, periodic stats fire once cluster-wide.

### UAT-E2E-4 — Internationalization
1. Switch language between English and Traditional Chinese on web and mobile.
- **Overall AC:** all user-facing text, status labels, and severity labels localize correctly and the choice persists.

---

## Sign-off

| Area | Owner | Result | Date |
|------|-------|--------|------|
| Citizen journeys (C1–C7) | | | |
| Family journeys (F1–F4) | | | |
| Volunteer journeys (V1–V2) | | | |
| Government journeys (G1–G6) | | | |
| Super-admin journeys (S1–S3) | | | |
| End-to-end (E2E-1…4) | | | |

**UAT exit criteria:** all P0/AC items pass; any open defect is triaged and either fixed or explicitly accepted with rationale (see [POST_REMEDIATION_REVIEW.md](remediation/POST_REMEDIATION_REVIEW.md) §4 for the known, accepted limitations).
