'use strict';

/*
 * Report-ingest policy: everything that decides WHAT may be stored and how a
 * report is attributed, separated from HOW it is stored (reportStore) and how
 * it arrives (routes). Every rule is a guard clause; the first failure throws
 * an HttpError that the central handler turns into the right 4xx.
 */

const { collection } = require('../db/mongo');
const { HttpError } = require('../lib/http');
const { logger } = require('../lib/logger');

/**
 * Identity is derived from the authenticated principal, never trusted from the
 * body. The one exception is the gov/admin token: trusted tooling may set
 * attribution explicitly (admin edits, tests, backfills).
 */
function applyIdentity(r, auth) {
  if (auth.kind === 'gov') return r;

  const { user_id, reported_for_user_id, ...safe } = r; // strip client-supplied identity
  if (safe.user_type === 'web') {
    // Proxy report by a logged-in family member about someone ELSE — the
    // affected person is resolved later; the submitter only names themselves.
    return { ...safe, reporter_name: auth.user?.name || safe.reporter_name || null };
  }
  // Self report: attributed to the bearer of the token.
  return { ...safe, user_id: auth.userId, reported_by: 'self', reporter_name: null };
}

/** Only the affected person may declare themselves safe, and only via mobile. */
function assertProxyStatusAllowed(r) {
  if (r.status !== 'safe') return;
  throw new HttpError(422,
    'Web proxy reports cannot use status "safe". The affected person must confirm their own safety via the mobile app.');
}

/** Latest location from the person's own (non-web) reports. */
async function latestNonWebLocation(filter) {
  const rows = await collection('reports')
    .find({ ...filter, user_type: { $ne: 'web' } })
    .project({ lat: 1, lng: 1 })
    .sort({ updated_at: -1 })
    .limit(1)
    .toArray();
  return rows.length ? { lat: rows[0].lat, lng: rows[0].lng } : null;
}

/** Proxy reports carry no browser GPS: person's last fix, else the disaster centre. */
async function resolveProxyLocation(r) {
  if (r.personal_id) {
    const loc = await latestNonWebLocation({ personal_id: r.personal_id });
    if (loc) return loc;
  }
  if (r.phone) {
    const loc = await latestNonWebLocation({ phone: r.phone });
    if (loc) return loc;
  }
  if (r.disaster_id) {
    const d = await collection('disasters').findOne({ _id: r.disaster_id }, { projection: { lat: 1, lng: 1 } });
    if (d) return { lat: d.lat, lng: d.lng };
  }
  return null;
}

/** Link the report to the affected person's account: HKID first, then phone. */
async function resolveReportedForUser(r) {
  if (r.reported_for_user_id) return r.reported_for_user_id;
  if (r.personal_id) {
    const u = await collection('users').findOne({ personal_id: r.personal_id }, { projection: { _id: 1 } });
    if (u) return u._id;
  }
  if (r.phone) {
    const u = await collection('users').findOne({ phone: r.phone }, { projection: { _id: 1 } });
    if (u) return u._id;
  }
  return null;
}

/** The web-proxy rulebook: status gate, family attribution, resolved location. */
async function applyProxyRules(r) {
  assertProxyStatusAllowed(r);
  r = { ...r, reported_by: 'family', reported_for_user_id: await resolveReportedForUser(r) };
  if (r.lat != null && r.lng != null) return r;

  const loc = await resolveProxyLocation(r);
  if (!loc) {
    throw new HttpError(422,
      'No known location for the affected person yet — they need to share their status from the mobile app, or include a disaster_id.');
  }
  return { ...r, lat: loc.lat, lng: loc.lng };
}

/** Never lose a report: an unknown disaster_id stores the report unlinked, not rejected. */
async function ensureKnownDisaster(r) {
  if (!r.disaster_id) return r;
  const known = await collection('disasters').findOne({ _id: r.disaster_id }, { projection: { _id: 1 } });
  if (known) return r;
  logger.warn('report_unknown_disaster_unlinked', { disaster_id: r.disaster_id });
  return { ...r, disaster_id: null };
}

/**
 * Validate + enrich a parsed report into its storable form.
 * Throws HttpError(4xx) when the report is not acceptable.
 */
async function prepareForStorage(parsed, auth) {
  let r = applyIdentity(parsed, auth);

  if (r.user_type === 'web') {
    r = await applyProxyRules(r);
  } else if (r.lat == null || r.lng == null) {
    throw new HttpError(400, 'lat and lng are required.');
  }
  return ensureKnownDisaster(r);
}

module.exports = { prepareForStorage };
