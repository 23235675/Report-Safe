'use strict';

/**
 * Geo utilities implemented from scratch (no npm packages), plus the ONE
 * radius-query implementation every domain uses: an index-friendly bounding
 * box prefilter, then an exact haversine pass. Cosmos for MongoDB has no
 * geospatial index tier on the free plan, so the box + exact-filter pair is
 * the deliberate strategy — do not replace it with $nearSphere.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Hard ceiling on how many docs a capped geo query pulls into the heap before
 * the exact haversine pass. A city-wide radius would otherwise stream a whole
 * collection into Node — an OOM risk on Azure B1 and an RU-exhaustion risk on
 * Cosmos Free. Well above any realistic single-radius hit.
 */
const GEO_SCAN_CAP = Number(process.env.GEO_SCAN_CAP) || 5000;

/**
 * Convert degrees to radians.
 * @param {number} deg
 * @returns {number}
 */
function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two points in kilometres (Haversine formula).
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} distance in km
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a =
    sinLat * sinLat +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      sinLng *
      sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Whether `point` is within `radiusKm` of `center`.
 * @param {{lat:number,lng:number}} point
 * @param {{lat:number,lng:number}} center
 * @param {number} radiusKm
 * @returns {boolean}
 */
function isWithinRadius(point, center, radiusKm) {
  const distance = haversineKm(point.lat, point.lng, center.lat, center.lng);
  return distance <= radiusKm;
}

/**
 * Latitude/longitude bounding box around a point, used as an index-friendly
 * prefilter before the exact (but unindexable) haversine distance check.
 *
 * The box is always a SUPERSET of the true radius circle, so the exact
 * `distance <= radius` filter that follows still returns every real match —
 * the box only lets the index skip far-away rows. If the box would cross a
 * pole or the antimeridian we widen it to the full range (correctness over
 * speed) rather than risk dropping valid rows.
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
 * haversine pass. Numeric range filters inherently exclude null/missing
 * lat|lng (type bracketing), so the box doubles as the "lat IS NOT NULL" guard.
 */
function boxFilter(lat, lng, radiusKm) {
  const bb = boundingBox(lat, lng, radiusKm);
  return {
    lat: { $gte: bb.latMin, $lte: bb.latMax },
    lng: { $gte: bb.lngMin, $lte: bb.lngMax },
  };
}

/**
 * The single radius query: box-prefiltered candidates → exact haversine →
 * distance-ascending rows, each `{ ...map(doc), distance_km }`.
 *
 * Parameterized so every call site keeps its exact semantics:
 * @param {string} collectionName
 * @param {{
 *   lat: number, lng: number, radiusKm: number,
 *   filter?: object,          extra Mongo filter merged with the box
 *   project?: object|null,    optional projection
 *   sort?: object|null,       pre-sort (with `cap`, decides WHICH rows survive
 *                             a capped scan — e.g. {updated_at:-1} keeps the
 *                             most recently active)
 *   cap?: number|null,        scan ceiling; null = unbounded (small collections)
 *   map?: (doc)=>object,      doc mapper applied before distance_km is attached
 * }} opts
 * @returns {Promise<object[]>}
 */
async function findWithinRadius(collectionName, { lat, lng, radiusKm, filter = {}, project = null, sort = null, cap = GEO_SCAN_CAP, map = (d) => d }) {
  const { collection } = require('../db/mongo'); // lazy: keeps pure helpers importable without a DB
  let q = collection(collectionName).find({ ...filter, ...boxFilter(lat, lng, radiusKm) });
  if (project) q = q.project(project);
  if (sort) q = q.sort(sort);
  if (cap != null) q = q.limit(cap);
  const candidates = await q.toArray();

  const within = [];
  for (const d of candidates) {
    const distance_km = haversineKm(lat, lng, d.lat, d.lng);
    if (distance_km <= radiusKm) within.push({ ...map(d), distance_km });
  }
  within.sort((a, b) => a.distance_km - b.distance_km);
  return within;
}

module.exports = {
  EARTH_RADIUS_KM,
  GEO_SCAN_CAP,
  haversineKm,
  isWithinRadius,
  boundingBox,
  boxFilter,
  findWithinRadius,
};
