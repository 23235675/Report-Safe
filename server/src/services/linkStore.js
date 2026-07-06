'use strict';

/*
 * Loved-one links: link CRUD plus the roster a user sees on the Family screen —
 * every link touching them, joined to the partner's profile and, for CONFIRMED
 * links only, the partner's latest report. A pending partner's status is
 * withheld until both sides consent — privacy before acceptance.
 */

const crypto = require('crypto');
const { collection } = require('../db/mongo');
const { isWithinRadius } = require('../lib/geo');
const { mapId, unwrap } = require('../lib/mongoMap');
const { HttpError } = require('../lib/http');

/** All pending/confirmed links touching a user. */
function findLinksTouching(userId) {
  return collection('account_links')
    .find({ $or: [{ user_a_id: userId }, { user_b_id: userId }], status: { $in: ['pending', 'confirmed'] } })
    .toArray();
}

/** Minimal partner profiles for the roster join, keyed by id. */
async function loadPartners(ids) {
  const users = await collection('users')
    .find({ _id: { $in: ids } })
    .project({ _id: 1, phone: 1, name: 1, personal_id: 1 })
    .toArray();
  return new Map(users.map((u) => [u._id, u]));
}

/**
 * Active disaster zones, recomputed per request rather than trusting the
 * disaster_id stamped on a report at creation time — a moved/resized zone, or
 * a disaster that started after the report was filed, still shows correctly.
 */
function loadActiveZones() {
  return collection('disasters')
    .find({ active: true })
    .project({ _id: 1, lat: 1, lng: 1, radius_km: 1 })
    .toArray();
}

function inAnyActiveZone(zones, lat, lng) {
  if (lat == null || lng == null) return false;
  return zones.some((z) => isWithinRadius({ lat, lng }, { lat: z.lat, lng: z.lng }, z.radius_km));
}

/**
 * A partner's latest report, matched by identity (user id / reported-for /
 * HKID / phone), never by display name.
 */
async function latestReportFor(u) {
  const or = [{ user_id: u._id }, { reported_for_user_id: u._id }];
  if (u.personal_id) or.push({ personal_id: u.personal_id });
  if (u.phone) or.push({ phone: u.phone });
  const docs = await collection('reports')
    .find({ $or: or })
    .project({ status: 1, updated_at: 1, disaster_id: 1, lat: 1, lng: 1 })
    .sort({ updated_at: -1 })
    .limit(1)
    .toArray();
  return docs[0] || null;
}

/** Latest report per CONFIRMED partner, resolved concurrently (no serial N+1). */
async function loadLatestByPartner(pairs, byId) {
  const confirmed = pairs.filter((p) => p.al.status === 'confirmed' && byId.has(p.partnerId));
  const rows = await Promise.all(
    confirmed.map(async (p) => [p.partnerId, await latestReportFor(byId.get(p.partnerId))])
  );
  return new Map(rows);
}

/** ORDER BY status ASC ('confirmed' before 'pending'), then newest link first. */
function byStatusThenNewest(a, b) {
  if (a.al.status !== b.al.status) return a.al.status < b.al.status ? -1 : 1;
  return (b.al.created_at || 0) - (a.al.created_at || 0);
}

/** One roster row. Report fields stay null unless the link is confirmed. */
function toRow({ al, u, r, isIncoming, zones }) {
  return {
    link_id: al._id,
    link_status: al.status,
    confirmed_at: al.confirmed_at ?? null,
    is_incoming: isIncoming,
    user_id: u._id,
    phone: u.phone,
    name: u.name,
    report_status: r ? (r.status ?? null) : null,
    status_updated_at: r && r.updated_at != null ? Number(r.updated_at) : null,
    disaster_id: r ? (r.disaster_id ?? null) : null,
    in_affected_zone: r ? inAnyActiveZone(zones, r.lat, r.lng) : false,
  };
}

/**
 * The Family-screen roster for one user.
 * Pipeline: links → (zones ∥ partners) → confirmed partners' latest reports → rows.
 */
async function getRoster(userId) {
  const links = await findLinksTouching(userId);
  if (links.length === 0) return [];

  const pairs = links.map((al) => ({
    al,
    partnerId: al.user_a_id === userId ? al.user_b_id : al.user_a_id,
    isIncoming: al.user_b_id === userId,
  }));

  const [zones, byId] = await Promise.all([
    loadActiveZones(),
    loadPartners([...new Set(pairs.map((p) => p.partnerId))]),
  ]);
  const latest = await loadLatestByPartner(pairs, byId);

  return pairs
    .filter((p) => byId.has(p.partnerId)) // drop a link whose partner vanished
    .sort(byStatusThenNewest)
    .map((p) => toRow({
      al: p.al,
      u: byId.get(p.partnerId),
      r: p.al.status === 'confirmed' ? latest.get(p.partnerId) || null : null,
      isIncoming: p.isIncoming,
      zones,
    }));
}

/** Request a link to another user by phone. Upsert on (requester, target). */
async function requestLink(userId, targetPhone) {
  const target = await collection('users').findOne({ phone: targetPhone }, { projection: { _id: 1 } });
  if (!target) throw new HttpError(404, 'Target user not found');
  if (target._id === userId) throw new HttpError(400, 'Cannot link to yourself');

  const res = await collection('account_links').findOneAndUpdate(
    { user_a_id: userId, user_b_id: target._id },
    {
      $set: { status: 'pending', created_at: Date.now() },
      $setOnInsert: { _id: crypto.randomUUID(), confirmed_at: null },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return mapId(unwrap(res));
}

/** Confirm a pending link — only the recipient (user_b) may accept. */
async function confirmLink(userId, linkId) {
  const res = await collection('account_links').findOneAndUpdate(
    { _id: linkId, user_b_id: userId, status: 'pending' },
    { $set: { status: 'confirmed', confirmed_at: Date.now() } },
    { returnDocument: 'after' }
  );
  const al = unwrap(res);
  if (!al) throw new HttpError(404, 'Pending link not found');
  return mapId(al);
}

/** Remove a link — either side may remove; removing a non-existent link is a no-op. */
async function removeLink(userId, linkId) {
  await collection('account_links').deleteOne({
    _id: linkId,
    $or: [{ user_a_id: userId }, { user_b_id: userId }],
  });
}

module.exports = { getRoster, requestLink, confirmLink, removeLink };
