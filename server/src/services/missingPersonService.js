'use strict';

const { escalateStaleReports } = require('./reportStore');

/**
 * Missing Person Escalation Engine.
 *
 * Runs on a configurable interval and performs two escalation passes:
 *
 *   Pass 1: need_help reports with updated_at older than NEED_HELP_THRESHOLD_MS
 *           → status becomes 'awaiting_response'
 *           (person requested rescue but no follow-up received)
 *
 *   Pass 2: awaiting_response reports with updated_at older than AWAITING_THRESHOLD_MS
 *           → status becomes 'potentially_missing'
 *
 * After each run it broadcasts updated stats to all connected dashboards.
 */

const NEED_HELP_THRESHOLD_MS = Number(process.env.NEED_HELP_THRESHOLD_MS) || 45 * 60 * 1000;  // 45 min
const AWAITING_THRESHOLD_MS  = Number(process.env.AWAITING_THRESHOLD_MS)  || 2  * 60 * 60 * 1000; // 2 hrs
const POLL_INTERVAL_MS       = Number(process.env.MISSING_POLL_INTERVAL_MS) || 5 * 60 * 1000; // 5 min

let timer = null;

async function runEscalation(io) {
  try {
    const { escalatedToAwaiting, escalatedToMissing } = await escalateStaleReports(
      NEED_HELP_THRESHOLD_MS,
      AWAITING_THRESHOLD_MS
    );

    if (escalatedToAwaiting > 0 || escalatedToMissing > 0) {
      console.log(
        `[missingPersonService] escalated ${escalatedToAwaiting} → awaiting_response, ` +
        `${escalatedToMissing} → potentially_missing`
      );

      // Broadcast fresh stats so dashboards update immediately.
      if (io) {
        const { broadcastStats } = require('./realtimeService');
        broadcastStats(io);
      }
    }
  } catch (err) {
    console.error('[missingPersonService.runEscalation] failed:', err);
  }
}

function startEscalation(io) {
  const { runIfLeader } = require('../lib/leaderLock');
  const ttl = Math.ceil(POLL_INTERVAL_MS * 1.1);
  // Leader-gated (C4) so escalations + their status_history rows run once, not
  // once per instance.
  const tick = () => runIfLeader('escalation', ttl, () => runEscalation(io)).catch(() => {});

  tick(); // run once on startup so stale data from previous sessions is handled
  timer = setInterval(tick, POLL_INTERVAL_MS);
  if (timer.unref) timer.unref();

  console.log(
    `[missingPersonService] started — need_help threshold: ${NEED_HELP_THRESHOLD_MS / 60000}m, ` +
    `awaiting threshold: ${AWAITING_THRESHOLD_MS / 60000}m`
  );
}

function stopEscalation() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startEscalation, stopEscalation, runEscalation };
