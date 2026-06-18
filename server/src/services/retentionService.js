'use strict';

const { collection } = require('../db/mongo');

/*
 * PDPO Data Protection Principle 2 (retention): personal data must not be kept
 * longer than necessary for the purpose it was collected.
 *
 * This job purges RESOLVED reports (safe / rescued / deceased) whose last
 * update is older than RETENTION_DAYS. status_history rows cascade with them.
 * Unresolved cases (need_help, injured, missing, etc.) are NEVER auto-purged —
 * they may still be needed for rescue/coordination.
 *
 * Disabled by default (RETENTION_DAYS unset or 0) so it can never delete data
 * unexpectedly; opt in per deployment.
 */

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 0;
const DAY_MS = 24 * 60 * 60 * 1000;

let timer = null;

async function purgeExpired() {
  if (RETENTION_DAYS <= 0) return { purged: 0 };
  try {
    const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
    const reports = collection('reports');
    const expired = await reports
      .find({ updated_at: { $lt: cutoff }, status: { $in: ['safe', 'rescued', 'deceased'] } }, { projection: { _id: 1 } })
      .toArray();
    const ids = expired.map((d) => d._id);
    if (ids.length === 0) return { purged: 0 };

    await reports.deleteMany({ _id: { $in: ids } });
    // status_history rows cascaded with the report under the SQL FK — emulate it.
    await collection('status_history').deleteMany({ report_id: { $in: ids } }).catch(() => {});
    console.log(`[retention] purged ${ids.length} resolved report(s) older than ${RETENTION_DAYS}d`);
    return { purged: ids.length };
  } catch (err) {
    console.error('[retention] purge failed:', err);
    return { purged: 0 };
  }
}

function startRetention() {
  if (RETENTION_DAYS <= 0) {
    console.log('[retention] disabled (set RETENTION_DAYS > 0 to enable the PDPO purge)');
    return;
  }
  purgeExpired().catch(() => {});
  timer = setInterval(() => purgeExpired().catch(() => {}), DAY_MS);
  if (timer.unref) timer.unref();
  console.log(`[retention] enabled — daily purge of resolved reports older than ${RETENTION_DAYS} days`);
}

function stopRetention() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startRetention, stopRetention, purgeExpired };
