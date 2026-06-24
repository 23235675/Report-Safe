'use strict';

/**
 * Geo utilities implemented from scratch (no npm packages).
 *
 * PRODUCTION MIGRATION PATH:
 *   In PostgreSQL + PostGIS these computations move into the database via
 *   ST_DWithin / ST_Distance / ST_Azimuth. The function signatures below stay
 *   identical so the service layer does not change.
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians.
 * @param {number} deg
 * @returns {number}
 */
function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Convert radians to degrees.
 * @param {number} rad
 * @returns {number}
 */
function toDegrees(rad) {
  return (rad * 180) / Math.PI;
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
 * Initial bearing (forward azimuth) from `from` to `to`.
 * @param {{lat:number,lng:number}} from
 * @param {{lat:number,lng:number}} to
 * @returns {number} bearing in degrees, normalised to [0,360), 0 = North
 */
function bearingTo(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

module.exports = {
  EARTH_RADIUS_KM,
  haversineKm,
  isWithinRadius,
  bearingTo,
};
