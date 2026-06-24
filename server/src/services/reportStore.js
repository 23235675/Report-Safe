'use strict';

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { haversineKm } = require('../lib/geo');
const { escapeRegex } = require('../lib/mongoMap');

/**
 * Triage priority tier for rescue sorting (0 = most urgent).
 *
 * CRITICAL (fixes M5): escalation must NEVER lower a case's priority. A
 * `need_help` that has gone silent (auto-escalated to `awaiting_response`)
 * is at least as urgent as the original call — it stays P1, never sinking
 * below a responsive `injured` case. Escalation changes the *status label*
 * for tracking/alerting, not the triage urgency.
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

/**
 * Human-readable priority label for each tier.
 */
const PRIORITY_LABEL = Object.freeze({
  0: 'P1',
  1: 'P2',
  2: 'P3',
  3: 'P4',
});

/** Every status the stats endpoint reports on (zero-filled when absent). */
const ALL_STATUSES = Object.freeze([
  'safe', 'injured', 'need_help', 'awaiting_response',
  'potentially_missing', 'missing', 'verified_missing', 'rescued', 'deceased',
]);

/**
 * Hard ceiling on how many docs any geo bounding-box query pulls into the heap
 * before the exact haversine pass (C2). A city-wide disaster (seeded T10 has
 * radius_km 60 → box covers all of HK) would otherwise stream the WHOLE
 * collection into Node — an OOM risk on Azure B1 and an RU-exhaustion (429)
 * risk on Cosmos Free. Well above any realistic single-radius hit, so normal
 * results are unaffected; only the pathological all-collection box is bounded.
 * ponytail: a scan ceiling, not cursor pagination — M7 adds paging for the tail.
 */
const GEO_SCAN_CAP = Number(process.env.GEO_SCAN_CAP) || 5000;

function coarsen(v) {
  return Math.round(v * 100) / 100;
}

/**
 * Map a stored Mongo document to the app's row shape: _id → id, and drop the
 * denormalised search helper `name_lower`. Mirrors the explicit column lists
 * the SQL SELECTs returned.
 */
function fromDoc(doc) {
  if (!doc) return doc;
  const { _id, name_lower, ...rest } = doc;
  return { id: _id, ...rest };
}

/**
 * Latitude/longitude bounding box around a point, used as an index-friendly
 * prefilter before the exact (but unindexable) haversine distance check.
 *
 * The box is always a SUPERSET of the true radius circle, so the exact
 * `distance <= radius` filter that follows still returns every real match —
 * the box only lets the index skip far-away rows via idx_reports_lat_lng.
 * If the box would cross a pole or the antimeridian we widen it to the full
 * range (correctness over speed) rather than risk dropping valid rows.
 */
function boundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 110.574;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngDelta = Math.abs(cosLat) < 1e-6 ? 180 : radiusKm / (111.320 * Math.abs(cosLat));
  const latMin = lat - latDelta, latMax = lat + latDelta;
  const lngMin = lng - lngDelta, lngMax = lng + lngDelta;
  if (latMin < -90 || latMax > 90 || lngMin < -180 || lngMax > 180) {
    return { latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 };
  }
  return { latMin, latMax, lngMin, lngMax };
}

/**
 * The index-friendly Mongo sub-filter for "inside the bounding box of
 * (lat,lng,radiusKm)". Spread into a find() filter, then refine with an exact
 * haversine pass. Single source of truth for the box→filter shape that the
 * shelters/aed/incident/disaster geo queries all build.
 */
function boxFilter(lat, lng, radiusKm) {
  const bb = boundingBox(lat, lng, radiusKm);
  return {
    lat: { $gte: bb.latMin, $lte: bb.latMax },
    lng: { $gte: bb.lngMin, $lte: bb.lngMax },
  };
}

/**
 * Append one row to the status_history audit trail (separate, write-only
 * collection — the app never reads it back). History must never block the main
 * write — log and continue on failure.
 */
async function recordStatusHistory(reportId, fromStatus, toStatus, changedBy, notes) {
  try {
    await collection('status_history').insertOne({
      _id: crypto.randomUUID(),
      report_id: reportId,
      from_status: fromStatus ?? null,
      to_status: toStatus,
      changed_by: changedBy || 'system',
      changed_at: Date.now(),
      notes: notes ?? null,
    });
  } catch (err) {
    console.error('[reportStore.recordStatusHistory] failed (continuing):', err);
  }
}

/**
 * Insert a new report or relay-increment if the UUID already exists.
 * Reports are linked to user accounts via user_id (the affected person) and
 * reported_for_user_id (set when a relative files on someone's behalf).
 *
 * Idempotent relay: a stable client UUID is the _id. We first try to bump an
 * existing doc; only if none exists do we insert. The unique _id makes a
 * concurrent double-submit (choppy network) safe — the insert loser catches the
 * 11000 duplicate-key and relays instead. This preserves the SQL
 * `ON CONFLICT (id) DO UPDATE relay_count++` semantics without a transaction.
 */
async function upsertReport(report) {
  try {
    const id  = report.id || crypto.randomUUID();
    const now = Date.now();
    const reports = collection('reports');

    // Relay path: already present → bump relay_count + updated_at only.
    const bumped = await reports.updateOne(
      { _id: id },
      { $inc: { relay_count: 1 }, $set: { updated_at: now } }
    );
    if (bumped.matchedCount > 0) {
      return { id, inserted: false };
    }

    // New report: insert the full document.
    const doc = {
      _id: id,
      name: report.name,
      name_lower: String(report.name || '').toLowerCase(),
      status: report.status,
      lat: report.lat,
      lng: report.lng,
      medical_notes: report.medical_notes ?? null,
      severity: report.severity ?? null,
      phone: report.phone ?? null,
      personal_id: report.personal_id ?? null,
      created_at: report.created_at || now,
      updated_at: now,
      relay_count: report.relay_count ?? 0,
      disaster_id: report.disaster_id ?? null,
      reported_by: report.reported_by ?? null,
      reporter_name: report.reporter_name ?? null,
      user_type: report.user_type ?? 'mobile',
      user_id: report.user_id ?? null,
      reported_for_user_id: report.reported_for_user_id ?? null,
    };
    try {
      await reports.insertOne(doc);
    } catch (err) {
      if (err.code === 11000) {
        // Lost an insert race (same UUID submitted twice) → treat as a relay.
        await reports.updateOne({ _id: id }, { $inc: { relay_count: 1 }, $set: { updated_at: now } });
        return { id, inserted: false };
      }
      throw err;
    }

    await recordStatusHistory(id, null, report.status, report.reported_by === 'family' ? 'family' : 'self');
    return { id, inserted: true };
  } catch (err) {
    console.error('[reportStore.upsertReport] failed:', err);
    throw err;
  }
}

/**
 * Find a person by NAME or PHONE — searches the registered USERS directory,
 * joined (app-side) to each user's most recent report for live status + coarse
 * location.
 *
 * This finds real loved ones (registered users) even before they file a report,
 * rather than only matching the reports table (which may carry placeholder names).
 *
 * PUBLIC/family tier: coarse coordinates only — never exact GPS, medical notes,
 * or HKID. Phone is returned in masked form (last 4 digits) so a searcher can
 * confirm they found the right person without exposing the full number.
 */
async function searchByName(queryStr, { limit = 100, offset = 0 } = {}) {
  try {
    if (!queryStr || !queryStr.trim()) return [];
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 100);
    const off = Math.max(Number(offset) || 0, 0);
    const q = queryStr.trim();

    // All-digits → phone search (match the last 8 digits). Else name PREFIX search
    // (H7): anchored `^q` instead of an unanchored scan, so the query can seek the
    // index rather than reading every citizen row on each lookup.
    // ponytail: anchored case-insensitive regex on `name`; for full index use on
    // Cosmos, denormalise a `name_lower` onto users and match that exactly.
    const isPhoneQuery = /^\d+$/.test(q);
    const userFilter = isPhoneQuery
      ? { role: 'citizen', phone: { $regex: escapeRegex(q.slice(-8)) + '$' } }
      : { role: 'citizen', name: { $regex: '^' + escapeRegex(q), $options: 'i' } };

    // Matched citizens (hard cap bounds memory for a broad regex on a big table).
    const users = await collection('users')
      .find(userFilter)
      .project({ _id: 1, name: 1, phone: 1, gender: 1 })
      .limit(1000)
      .toArray();
    if (users.length === 0) return [];

    const userIds = users.map((u) => u._id);
    const idSet = new Set(userIds);

    // Latest report per matched user (their own, or one filed for them).
    const reports = await collection('reports')
      .find({ $or: [{ user_id: { $in: userIds } }, { reported_for_user_id: { $in: userIds } }] })
      .project({ user_id: 1, reported_for_user_id: 1, status: 1, lat: 1, lng: 1, updated_at: 1, reported_by: 1, reporter_name: 1 })
      .sort({ updated_at: -1 })
      .toArray();

    const latest = new Map();
    for (const r of reports) {
      for (const uid of [r.user_id, r.reported_for_user_id]) {
        if (uid && idSet.has(uid) && !latest.has(uid)) latest.set(uid, r);
      }
    }

    const rows = users.map((u) => {
      const r = latest.get(u._id) || null;
      return {
        id:            u._id,
        name:          u.name,
        gender:        u.gender || null,
        status:        r ? (r.status || null) : null,   // null = registered but no report yet
        phone_masked:  maskPhone(u.phone),
        updated_at:    r && r.updated_at != null ? Number(r.updated_at) : null,
        coarse_lat:    r && r.lat != null ? coarsen(r.lat) : null,
        coarse_lng:    r && r.lng != null ? coarsen(r.lng) : null,
        reported_by:   r ? (r.reported_by   || null) : null,
        reporter_name: r ? (r.reporter_name || null) : null,
      };
    });

    // ORDER BY (has report) DESC, name ASC, then LIMIT/OFFSET.
    rows.sort((a, b) => {
      const ah = a.updated_at != null ? 1 : 0;
      const bh = b.updated_at != null ? 1 : 0;
      if (ah !== bh) return bh - ah;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return rows.slice(off, off + lim);
  } catch (err) {
    console.error('[reportStore.searchByName] failed:', err);
    throw err;
  }
}

/**
 * List every person with a filed report, newest-status-first — the public
 * Status Overview roster. Same masked-phone privacy tier as searchByName:
 * never the full phone, never exact GPS.
 */
async function listPeople({ limit = 50, offset = 0 } = {}) {
  try {
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const off = Math.max(Number(offset) || 0, 0);

    // ponytail: scan cap on latest-reports, matches the bound used by getRescueView.
    const reports = await collection('reports')
      .find({})
      .project({ user_id: 1, reported_for_user_id: 1, status: 1, updated_at: 1 })
      .sort({ updated_at: -1 })
      .limit(GEO_SCAN_CAP)
      .toArray();

    const latest = new Map();
    for (const r of reports) {
      const uid = r.reported_for_user_id || r.user_id;
      if (uid && !latest.has(uid)) latest.set(uid, r);
    }

    const allIds = [...latest.keys()];
    const pageIds = allIds.slice(off, off + lim);
    if (pageIds.length === 0) return { rows: [], total: allIds.length };

    const users = await collection('users')
      .find({ _id: { $in: pageIds } })
      .project({ _id: 1, name: 1, phone: 1 })
      .toArray();
    const userMap = new Map(users.map((u) => [u._id, u]));

    const rows = pageIds
      .map((uid) => {
        const u = userMap.get(uid);
        if (!u) return null;
        const r = latest.get(uid);
        return {
          id: uid,
          name: u.name,
          phone_masked: maskPhone(u.phone),
          status: r.status || null,
          updated_at: r.updated_at != null ? Number(r.updated_at) : null,
        };
      })
      .filter(Boolean);

    return { rows, total: allIds.length };
  } catch (err) {
    console.error('[reportStore.listPeople] failed:', err);
    throw err;
  }
}

/** Mask a phone for public display: "+85298765432" → "····5432". */
function maskPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return `····${digits.slice(-4)}`;
}

/**
 * Rescue/triage view: all reports within radiusKm sorted by priority then distance.
 * Returns full rows + distance_km + priority_label.
 *
 * A lat/lng bounding box (index-friendly) prefilters rows before the exact
 * haversine distance check, so this no longer scans the whole collection.
 */
async function getRescueView(lat, lng, radiusKm, { limit = 500, offset = 0 } = {}) {
  try {
    const lim = Math.min(Math.max(Number(limit) || 500, 1), 1000);
    const off = Math.max(Number(offset) || 0, 0);
    const bb = boundingBox(lat, lng, radiusKm);

    // Bound the scan (C2). Newest-first on the indexed updated_at so, if the cap
    // is hit, it's the most recently-active reports that survive — then the exact
    // haversine + priority sort below re-orders the survivors for triage.
    const candidates = await collection('reports')
      .find({ lat: { $gte: bb.latMin, $lte: bb.latMax }, lng: { $gte: bb.lngMin, $lte: bb.lngMax } })
      .sort({ updated_at: -1 })
      .limit(GEO_SCAN_CAP)
      .toArray();

    const within = [];
    for (const doc of candidates) {
      const distance_km = haversineKm(lat, lng, doc.lat, doc.lng);
      if (distance_km <= radiusKm) within.push({ ...fromDoc(doc), distance_km });
    }

    // ORDER BY priority(status) [ELSE 2], distance ASC.
    within.sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status] ?? 2;
      const pb = STATUS_PRIORITY[b.status] ?? 2;
      if (pa !== pb) return pa - pb;
      return a.distance_km - b.distance_km;
    });

    return within.slice(off, off + lim).map((r) => {
      const priority = STATUS_PRIORITY[r.status] ?? 3;
      return {
        ...r,
        created_at:     Number(r.created_at),
        updated_at:     Number(r.updated_at),
        distance_km:    Number(r.distance_km),
        priority,
        priority_label: PRIORITY_LABEL[priority],
      };
    });
  } catch (err) {
    console.error('[reportStore.getRescueView] failed:', err);
    throw err;
  }
}

/**
 * Aggregate status counts in a single pass ($group) plus one active-disaster count.
 */
async function getStats({ excludeWeb = false } = {}) {
  try {
    const pipeline = [];
    if (excludeWeb) {
      // WHERE (user_type IS NULL OR user_type = 'mobile') — also matches docs
      // with no user_type field at all.
      pipeline.push({ $match: { $or: [{ user_type: 'mobile' }, { user_type: null }, { user_type: { $exists: false } }] } });
    }
    pipeline.push({ $group: { _id: '$status', n: { $sum: 1 } } });

    const [byStatus, activeDisasters] = await Promise.all([
      collection('reports').aggregate(pipeline).toArray(),
      collection('disasters').countDocuments({ active: true }),
    ]);

    const counts = {};
    for (const s of ALL_STATUSES) counts[s] = 0;
    let total = 0;
    for (const row of byStatus) {
      total += row.n;
      if (row._id in counts) counts[row._id] = row.n;
    }

    return { total, ...counts, active_disasters: activeDisasters };
  } catch (err) {
    console.error('[reportStore.getStats] failed:', err);
    throw err;
  }
}

/**
 * Update the status of a single report (used by missingPersonService).
 * Records the transition in status_history.
 */
async function updateStatus(id, newStatus, changedBy = 'system') {
  try {
    const res = await collection('reports').findOneAndUpdate(
      { _id: id },
      { $set: { status: newStatus, updated_at: Date.now() } },
      { returnDocument: 'before' }
    );
    // Driver v6 returns the doc directly; v5 wrapped it in { value }.
    const before = res && res.value !== undefined ? res.value : res;
    if (before) {
      await recordStatusHistory(id, before.status, newStatus, changedBy);
    }
  } catch (err) {
    console.error('[reportStore.updateStatus] failed:', err);
    throw err;
  }
}

/**
 * Escalate stale reports:
 *   need_help older than thresholdMs → awaiting_response
 *   awaiting_response older than thresholdMs → potentially_missing
 * Returns count of escalated rows.
 *
 * No transaction (Cosmos RU-based): each tier is found → updateMany → history
 * insert. status_history is write-only/best-effort, so a failed history insert
 * is logged loudly but never blocks the escalation (matches prior semantics).
 * Escalated rows get updated_at = now, so they can't be re-picked by the next
 * tier's `updated_at < threshold` filter in the same pass.
 */
async function escalateStaleReports(needHelpThresholdMs, awaitingThresholdMs) {
  try {
    const now = Date.now();
    const reports = collection('reports');

    const escalate = async (fromStatus, toStatus, thresholdMs) => {
      const stale = await reports
        .find({ status: fromStatus, updated_at: { $lt: now - thresholdMs } }, { projection: { _id: 1 } })
        .toArray();
      const ids = stale.map((d) => d._id);
      if (ids.length === 0) return 0;

      await reports.updateMany({ _id: { $in: ids } }, { $set: { status: toStatus, updated_at: now } });
      try {
        await collection('status_history').insertMany(
          ids.map((id) => ({
            _id: crypto.randomUUID(), report_id: id, from_status: fromStatus,
            to_status: toStatus, changed_by: 'escalation-engine', changed_at: now, notes: null,
          })),
          { ordered: false }
        );
      } catch (e) {
        console.error('[reportStore.escalateStaleReports] history insert failed (continuing):', e.message);
      }
      return ids.length;
    };

    const escalatedToAwaiting = await escalate('need_help', 'awaiting_response', needHelpThresholdMs);
    const escalatedToMissing  = await escalate('awaiting_response', 'potentially_missing', awaitingThresholdMs);
    return { escalatedToAwaiting, escalatedToMissing };
  } catch (err) {
    // Swallowing here is deliberate (background engine must not crash the
    // poll loop) — but the failure is loud in the log.
    console.error('[reportStore.escalateStaleReports] failed:', err);
    return { escalatedToAwaiting: 0, escalatedToMissing: 0 };
  }
}

/**
 * Return all shelters within radiusKm sorted by distance.
 * Uses the same bounding-box prefilter + JS haversine as the rescue view.
 */
async function getShelters(lat, lng, radiusKm) {
  try {
    const bb = boundingBox(lat, lng, radiusKm);
    const candidates = await collection('shelters')
      .find({ active: true, lat: { $gte: bb.latMin, $lte: bb.latMax }, lng: { $gte: bb.lngMin, $lte: bb.lngMax } })
      .sort({ lat: 1 }) // indexed; makes the cap deterministic (C2)
      .limit(GEO_SCAN_CAP)
      .toArray();

    const within = [];
    for (const doc of candidates) {
      const distance_km = haversineKm(lat, lng, doc.lat, doc.lng);
      if (distance_km <= radiusKm) within.push({ ...fromDoc(doc), distance_km });
    }
    within.sort((a, b) => a.distance_km - b.distance_km);
    return within;
  } catch (err) {
    console.error('[reportStore.getShelters] failed:', err);
    return [];
  }
}

/**
 * PDPO erasure (DPP6 / data-subject deletion): delete the account and scrub
 * personal data from any reports tied to it. Report rows are kept (so aggregate
 * counts stay intact) but their identifying fields are nulled and the user
 * linkage is cleared (mirrors the old FK ON DELETE SET NULL).
 *
 * MongoDB has no FK cascades, so the cascades the SQL schema declared are
 * emulated here explicitly:
 *   account_links       ON DELETE CASCADE  → delete links touching the user
 *   device_push_tokens  ON DELETE CASCADE  → delete the user's device handles
 *   safe_places         ON DELETE CASCADE  → delete the user's submissions
 *   reports.user_id / reported_for_user_id ON DELETE SET NULL → nulled in scrub
 */
async function eraseUserData(userId) {
  try {
    const now = Date.now();
    // Phase 1a — scrub PII from the user's reports (rows kept for aggregate counts).
    const scrub = await collection('reports').updateMany(
      { $or: [{ user_id: userId }, { reported_for_user_id: userId }] },
      {
        $set: {
          name: 'Erased', name_lower: 'erased', phone: null, personal_id: null,
          medical_notes: null, reporter_name: null,
          user_id: null, reported_for_user_id: null, updated_at: now,
        },
      }
    );

    // Phase 1b — scrub PII from the USER doc IN PLACE and tombstone it FIRST, so
    // a crash after this point can never leave PII behind (M1) — only a PII-free
    // pending tombstone that finalizePendingErasures() cleans up. phone is a
    // (non-sparse) unique index → use a per-user sentinel so multiple tombstones
    // don't collide; personal_id is $unset so the sparse-unique index drops it.
    const marked = await collection('users').findOneAndUpdate(
      { _id: userId },
      {
        $set: {
          name: 'Erased', name_lower: 'erased', phone: `erased-${userId}`, email: null,
          access_token_hash: null, refresh_token_hash: null, prev_refresh_token_hash: null,
          deletion_state: 'pending', deletion_requested_at: now, updated_at: now,
        },
        $unset: { personal_id: '' },
      },
      { returnDocument: 'after' }
    );
    const existed = marked && marked.value !== undefined ? marked.value : marked;
    if (!existed) return { deleted: 0, reportsScrubbed: scrub.modifiedCount };

    // Phase 2 — cascade deletes (idempotent) then drop the tombstone.
    await finalizePendingErasures(userId);
    return { deleted: 1, reportsScrubbed: scrub.modifiedCount };
  } catch (err) {
    console.error('[reportStore.eraseUserData] failed:', err);
    throw err;
  }
}

/**
 * Finalize PDPO erasure tombstones (M1 phase 2): emulate the SQL FK cascades and
 * remove the (already PII-free) user doc. Idempotent — safe to re-run after a
 * crash. Pass a userId to finalize one, or omit to sweep every pending tombstone
 * (called from the retention job for crash recovery).
 */
async function finalizePendingErasures(userId) {
  const filter = userId
    ? { _id: userId }
    : { deletion_state: 'pending' };
  const pending = await collection('users').find(filter, { projection: { _id: 1 } }).limit(500).toArray();
  for (const { _id } of pending) {
    await collection('account_links').deleteMany({ $or: [{ user_a_id: _id }, { user_b_id: _id }] });
    await collection('device_push_tokens').deleteMany({ user_id: _id });
    await collection('safe_places').deleteMany({ created_by_user_id: _id });
    await collection('users').deleteOne({ _id });
  }
  return { finalized: pending.length };
}

module.exports = {
  STATUS_PRIORITY,
  PRIORITY_LABEL,
  boundingBox,
  boxFilter,
  fromDoc,
  escapeRegex,
  recordStatusHistory,
  upsertReport,
  searchByName,
  listPeople,
  getRescueView,
  getStats,
  updateStatus,
  escalateStaleReports,
  getShelters,
  eraseUserData,
  finalizePendingErasures,
  coarsen,
};
