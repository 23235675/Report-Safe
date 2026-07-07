# UAT Checklist — Report Safe (報平安)

> **Purpose.** A manual **User Acceptance Test** script a real person walks through before a
> release. The server API behind every flow below is now covered by the automated suite
> (review §7), so UAT is the **UI-and-device complement** — the Vue dashboards, the React
> Native app, and the human end of the family/escalation/audit paths that no automated test
> can drive. For the full coverage picture, see [qa-uat-review.md](qa-uat-review.md).
>
> **How to record.** Mark each row **Pass / Fail / Blocked** and add a note (screenshot,
> reqId, or reproduction) on any Fail. A release is "accepted" when every 🔴 **must-pass** row
> passes and no open 🔴 defects remain.

## Environments & setup

| | |
|---|---|
| **Live API / web** | `https://report-safe-api-23235675.azurewebsites.net/` (dashboards served here) |
| **Mobile** | Expo build of `mobile/` pointed at the same API |
| **Dashboards** | Gov `/gov` · Admin `/admin` |
| **Test accounts** | 2 citizens on **two physical devices** (A = "subject", B = "relative"), 1 government login, 1 super-admin login |

**Two staging tweaks that make UAT observable** (set on the App Service, restart, and note them in the run):
- `NEED_HELP_THRESHOLD_MS=120000` + `AWAITING_THRESHOLD_MS=240000` — shrinks escalation from 45 min / 2 hr to **2 min / 4 min** so a tester can watch a report climb to *potentially missing* within one session (§3.4).
- `OTP_ENABLED=true` (optional) — to exercise the OTP path (§1.1); leave unset for the frictionless path. In dev/staging the code is echoed back as `dev_code`.

Legend: 🔴 must-pass · 🟡 should-pass · Result = Pass / Fail / Blocked

---

## 1. Citizen — mobile (the emergency path)

| # | Pri | Steps | Expected result | Result |
|---|---|---|---|---|
| 1.1 | 🔴 | Register a new citizen: phone + name + **gender** + HKID, accept the privacy consent | Account created; you're signed in. Without consent, registration is refused. If `OTP_ENABLED`, registration first demands a code | |
| 1.2 | 🟡 | Sign out, then sign back in with the same phone | Logged in without re-entering profile (phone-only / OTP login) | |
| 1.3 | 🔴 | Submit a status report (e.g. **Need help**) with location on | Report appears as submitted/delivered; a matching entry shows for gov (§3.2) | |
| 1.4 | 🔴 **never-lose** | Enable **airplane mode**, submit a report, confirm it shows "queued/pending", then re-enable connectivity | The queued report delivers automatically on reconnect — nothing is lost, no manual retry | |
| 1.5 | 🟡 | Submit the *same* report again (double-tap / relaunch mid-send) | Exactly one report server-side; no duplicate (idempotent on its UUID) | |
| 1.6 | 🟡 | Opt in as a **CFR responder** (skills + travel radius), then opt out | Opt-in saved; opt-out clears skills. Only you can change your own profile | |
| 1.7 | 🔴 | Trigger a disaster whose zone covers device A (gov does §3.1); keep the app in range | Device A receives the disaster alert; a device **outside** the zone does **not** | |

---

## 2. Family / proxy — the consent-gated loved-one path

> This is the human side of P1 gap #1. New automated coverage lives in
> [`tests/accountLinks.test.js`](tests/accountLinks.test.js) — UAT confirms it end-to-end on two devices.

| # | Pri | Steps | Expected result | Result |
|---|---|---|---|---|
| 2.1 | 🔴 | On device A, send a loved-one link request to device B's phone | B sees an **incoming** pending request; A sees it as **outgoing** pending | |
| 2.2 | 🔴 **consent gate** | Before B accepts, check A's roster view of B | B's **report status is hidden** while the link is only pending | |
| 2.3 | 🔴 | On device B, **confirm** the request | Link becomes confirmed on both sides; B's status now visible to A (and vice-versa) | |
| 2.4 | 🟡 | Try to "confirm" from the **requester** side (A) | Not possible — only the recipient can accept | |
| 2.5 | 🔴 **cascade** | Put device A in a disaster zone (§3.1). Keep B **outside** the zone | B (a *confirmed* loved one) is alerted that A is in an affected area — **without** B entering disaster mode. A merely-pending relative is **not** alerted | |
| 2.6 | 🟡 | Remove the link from either side | Disappears from both rosters; removing again is harmless | |
| 2.7 | 🔴 **web proxy** | On the **web** app, file a proxy report for a relative and try status **"Safe"** | "Safe" is refused for web/proxy; a non-safe status is accepted. Location is inherited from the subject's own mobile report, and is refused if the subject has no known location | |

---

## 3. Government — the dashboard (`/gov`)

| # | Pri | Steps | Expected result | Result |
|---|---|---|---|---|
| 3.1 | 🔴 | Trigger a manual disaster (type, severity, centre, radius) | Disaster activates; in-radius mobile devices get alerted (§1.7). A second active disaster of the same type is de-duplicated, not doubled | |
| 3.2 | 🔴 **PII tier** | Open the rescue/triage list | Reports sorted by urgency (need_help → injured → safe); the authenticated rescue tier shows **full** PII (phone, HKID, GPS) that the public tier never exposes | |
| 3.3 | 🔴 | Run a CFR incident: dispatch → a responder marks *enroute*/*onscene* → resolve | Nearby matching responders are alerted; responder status updates; a **residential** (non-public) incident is visible **only** to government responders; you cannot respond to a resolved incident | |
| 3.4 | 🔴 **escalation** | File a *need help* report, then wait past the (shortened) thresholds without updating it | It climbs **need_help → awaiting_response → potentially_missing** on its own; the dashboard count updates live | |
| 3.5 | 🟡 | Deactivate a disaster, then re-trigger the same type | Deactivation works; the type is free to trigger again afterwards | |
| 3.6 | 🟡 **safe places** | Moderate a **citizen-submitted safe place**: approve one, reject one | A citizen submission starts **pending** (not public); approving makes it publicly visible; rejected/pending stay hidden; only gov/volunteer can moderate | |
| 3.7 | 🟡 **shelters** | As gov/volunteer, **add a shelter**, update its occupancy, then remove it | Shelter is **active and publicly listed immediately** (no approval queue); occupancy updates; removal drops it from the public list but the record persists (soft-delete); a citizen cannot create/edit one | |
| 3.8 | 🟡 | Open, update, and close a **missing-person** case | Case lifecycle works; closing removes it from the active queue | |

---

## 4. Super admin — the console (`/admin`)

| # | Pri | Steps | Expected result | Result |
|---|---|---|---|---|
| 4.1 | 🔴 | Log in with the super-admin phone + password | Access granted; a wrong password is rejected; the login endpoint is brute-force rate-limited | |
| 4.2 | 🔴 **audit** | Perform any mutation (edit a user, change a report status), then open the **audit trail** | A matching audit row is written for the action (who/what/when) — the audit guarantee is visibly upheld | |
| 4.3 | 🔴 **safety guard** | Try to demote or delete **your own** super-admin account | Blocked with a clear message; your role is unchanged | |
| 4.4 | 🟡 | Filter/search users and reports; page through a long list | Filters and cursor pagination work; a search string with punctuation/SQL-ish characters returns safely (no error, no injection) | |
| 4.5 | 🟡 | Promote a user to super-admin **without** a password | Refused — a super-admin must have a password | |
| 4.6 | 🟡 | (If `ADMIN_IP_ALLOWLIST` is set) hit `/admin` from a non-allowlisted network | Access refused — the unmasked-HKID surface is network-restricted | |

---

## 5. Cross-cutting — privacy, i18n, accessibility, resilience

> Accessibility & bilingual support are a stated bar for this project (GovTech UI/UX standard);
> treat 5.3–5.4 as must-pass, not nice-to-have.

| # | Pri | Steps | Expected result | Result |
|---|---|---|---|---|
| 5.1 | 🔴 **privacy** | As an unauthenticated/public user, search for a person | Only coarse (≈2-decimal) location and a masked phone (`····4567`) — never full phone, HKID, or medical notes | |
| 5.2 | 🟡 **stats** | Compare official affected counts with/without web proxy reports | Web proxy reports are **excluded** from official stats by default (only mobile counts) | |
| 5.3 | 🔴 **i18n** | Toggle language (中文 ⇄ EN) across mobile + both dashboards | All UI strings switch; no untranslated keys, no clipped/overflowing labels | |
| 5.4 | 🔴 **a11y** | Keyboard-only navigation of the dashboards; check focus order, visible focus ring, colour contrast, and a screen-reader pass on the primary flows | All interactive elements reachable and operable; contrast meets AA; status conveyed by more than colour alone | |
| 5.5 | 🟡 **resilience** | With Redis unavailable (single-instance), exercise reporting + rate limits | App still works; abuse protection still enforced (fails closed, not open) | |
| 5.6 | 🟡 | Request a **PDPO erasure** (delete account) from the app | Account deleted; the person's PII is scrubbed from their reports; HKID no longer retrievable | |

---

## Sign-off

| Role | Name | Date | All must-pass (🔴) green? | Open defects |
|---|---|---|---|---|
| QA / Tester | | | | |
| Product / Gov owner | | | | |

**Related:** automated-coverage review → [qa-uat-review.md](qa-uat-review.md) · new P1 suites → [`tests/accountLinks.test.js`](tests/accountLinks.test.js), [`tests/escalation.test.js`](tests/escalation.test.js), [`tests/retention.test.js`](tests/retention.test.js)
