import * as Location from 'expo-location';

/** HK-centre fallback used whenever a real fix isn't available. */
export const DEFAULT_LOCATION = { lat: 22.3, lng: 114.1 };

/**
 * Dev-only location override. Set EXPO_PUBLIC_DEV_LOCATION="lat,lng" in .env to
 * pin the device to a fixed spot (e.g. one outside every disaster zone, so the
 * disaster gate never fires and you can test the rest of the app). Unset in
 * real builds ⇒ no effect. ponytail: env override, delete the .env line to revert.
 */
function devLocationOverride(): { lat: number; lng: number } | null {
  const raw = process.env.EXPO_PUBLIC_DEV_LOCATION;
  if (!raw) return null;
  const [lat, lng] = raw.split(',').map((n: string) => Number(n.trim()));
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * Resolve the device location WITHOUT ever hanging. `getCurrentPositionAsync`
 * has no built-in timeout and never resolves when there's no GPS fix — exactly
 * the case in a disaster, which would trap a safety report on the spinner
 * forever. Cap the wait, then fall back to the last known fix, then HK centre.
 */
export async function resolveLocation(timeoutMs = 8000): Promise<{ lat: number; lng: number }> {
  const dev = devLocationOverride();
  if (dev) return dev;
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return DEFAULT_LOCATION;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({}),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    if (pos) return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
    return DEFAULT_LOCATION;
  } catch {
    return DEFAULT_LOCATION;
  }
}
