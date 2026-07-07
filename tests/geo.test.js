import { describe, it, expect } from 'vitest';

// P3 — the pure geo primitives behind the one radius-query implementation every
// domain uses (findWithinRadius is exercised via routes; these are its building
// blocks + the edge cases those routes never hit: exact-radius boundary, and the
// pole/antimeridian widening that keeps the box a superset of the true circle).
const { haversineKm, isWithinRadius, boundingBox } = require('../server/src/lib/geo');

describe('haversineKm', () => {
  it('is ~0 for identical points', () => {
    expect(haversineKm(22.30, 114.17, 22.30, 114.17)).toBeCloseTo(0, 5);
  });
  it('~111 km per degree of latitude along a meridian', () => {
    const d = haversineKm(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
  it('matches a known long distance (HK ↔ Singapore ≈ 2570 km)', () => {
    const d = haversineKm(22.30, 114.17, 1.35, 103.82);
    expect(d).toBeGreaterThan(2400);
    expect(d).toBeLessThan(2700);
  });
});

describe('isWithinRadius (boundary is inclusive)', () => {
  const center = { lat: 22.30, lng: 114.17 };
  it('includes a point just inside and excludes one just outside (~111 km north)', () => {
    const north = { lat: 23.30, lng: 114.17 }; // ~111.19 km away
    expect(isWithinRadius(north, center, 112)).toBe(true);
    expect(isWithinRadius(north, center, 110)).toBe(false);
  });
  it('true for the centre at radius 0', () => {
    expect(isWithinRadius(center, center, 0)).toBe(true);
  });
});

describe('boundingBox (always a superset of the radius circle)', () => {
  it('brackets the point by at least the latitude delta', () => {
    const bb = boundingBox(22.30, 114.17, 10);
    expect(bb.latMax).toBeGreaterThan(22.30);
    expect(bb.latMin).toBeLessThan(22.30);
    expect(bb.latMax - 22.30).toBeGreaterThanOrEqual(10 / 110.574 - 1e-9);
  });
  it('widens to the full range near a pole (never drops valid rows)', () => {
    expect(boundingBox(89.9, 0, 100)).toEqual({ latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 });
  });
  it('widens to the full range near the antimeridian', () => {
    expect(boundingBox(0, 179.9, 100)).toEqual({ latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 });
  });
});
