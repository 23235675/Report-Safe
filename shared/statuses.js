'use strict';

/*
 * Canonical report-status vocabulary — the single source of truth.
 * Server consumes this directly (zodSchemas enum, reportStore priorities).
 * web/src/iconography.js and mobile/src/theme.ts keep presentation copies;
 * scripts/check-shared-drift.mjs fails CI if they drift from this list.
 */

/** Every report status, in stats-display order. */
const REPORT_STATUSES = Object.freeze([
  'safe', 'injured', 'need_help', 'awaiting_response',
  'potentially_missing', 'missing', 'verified_missing', 'rescued', 'deceased',
]);

/**
 * Triage priority tier for rescue sorting (0 = most urgent).
 *
 * CRITICAL invariant: escalation must NEVER lower a case's priority. A
 * `need_help` that has gone silent (auto-escalated to `awaiting_response`) is
 * at least as urgent as the original call — it stays P1, never sinking below a
 * responsive `injured` case. Escalation changes the *status label* for
 * tracking/alerting, not the triage urgency.
 *
 *   P1 (0) need_help, awaiting_response   — active or silent call for help
 *   P2 (1) injured, potentially_missing, verified_missing, missing
 *   P3 (2) safe, rescued
 *   P4 (3) deceased
 */
const STATUS_PRIORITY = Object.freeze({
  need_help:           0,
  awaiting_response:   0,
  injured:             1,
  potentially_missing: 1,
  verified_missing:    1,
  missing:             1,
  safe:                2,
  rescued:             2,
  deceased:            3,
});

/** Human-readable priority label for each tier. */
const PRIORITY_LABEL = Object.freeze({
  0: 'P1',
  1: 'P2',
  2: 'P3',
  3: 'P4',
});

module.exports = { REPORT_STATUSES, STATUS_PRIORITY, PRIORITY_LABEL };
