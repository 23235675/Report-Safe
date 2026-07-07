import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// resolveLocation must NEVER hang (no GPS fix in a disaster is the norm — an
// unbounded getCurrentPositionAsync would trap a safety report on the spinner).
// expo-location is mocked so each branch is driven directly.
const mock = vi.hoisted(() => ({
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
}));
vi.mock('expo-location', () => mock);

import { resolveLocation, DEFAULT_LOCATION } from './location';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.EXPO_PUBLIC_DEV_LOCATION;
  mock.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
});
afterEach(() => { delete process.env.EXPO_PUBLIC_DEV_LOCATION; });

describe('resolveLocation', () => {
  it('uses the dev override when set (no GPS calls)', async () => {
    process.env.EXPO_PUBLIC_DEV_LOCATION = '1.5, 103.8';
    expect(await resolveLocation()).toEqual({ lat: 1.5, lng: 103.8 });
    expect(mock.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('falls back to HK centre when permission is denied', async () => {
    mock.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await resolveLocation()).toEqual(DEFAULT_LOCATION);
  });

  it('returns a live fix when one is available', async () => {
    mock.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: 22.28, longitude: 114.15 } });
    expect(await resolveLocation()).toEqual({ lat: 22.28, lng: 114.15 });
  });

  it('times out → last known fix', async () => {
    mock.getCurrentPositionAsync.mockReturnValue(new Promise(() => {})); // never resolves
    mock.getLastKnownPositionAsync.mockResolvedValue({ coords: { latitude: 22.4, longitude: 114.2 } });
    expect(await resolveLocation(10)).toEqual({ lat: 22.4, lng: 114.2 });
  });

  it('times out with no last-known fix → HK centre', async () => {
    mock.getCurrentPositionAsync.mockReturnValue(new Promise(() => {}));
    mock.getLastKnownPositionAsync.mockResolvedValue(null);
    expect(await resolveLocation(10)).toEqual(DEFAULT_LOCATION);
  });

  it('any thrown error → HK centre (never propagates)', async () => {
    mock.requestForegroundPermissionsAsync.mockRejectedValue(new Error('boom'));
    expect(await resolveLocation()).toEqual(DEFAULT_LOCATION);
  });
});
