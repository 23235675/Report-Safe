'use strict';

/**
 * Geo utilities implemented from scratch (no npm packages).
 *
 * PRODUCTION MIGRATION PATH:
 *   In PostgreSQL + PostGIS these computations move into the database via
 *   ST_DWithin / ST_Distance. The function signatures below stay
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

module.exports = {
  EARTH_RADIUS_KM,
  haversineKm,
  isWithinRadius,
};
