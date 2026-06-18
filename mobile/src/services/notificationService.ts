import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Disaster } from '../api/apiClient';
import { registerDeviceToken } from '../api/apiClient';

/**
 * Local disaster notifications (in-app + OS banner).
 *
 * Scope: this fires a LOCAL notification the moment a `disaster_alert` arrives
 * over the socket while the app is running (foreground or background). It is NOT
 * remote push — waking a fully-closed app needs an EAS projectId + Expo push
 * tokens (documented migration path). Local notifications work in Expo Go and
 * dev builds without any project configuration.
 *
 * Every call is defensively wrapped: a missing module, denied permission, or
 * unsupported platform must never crash the app during a disaster.
 */

const ANDROID_CHANNEL_ID = 'disaster-alerts';

let configured = false;

/** Install the foreground handler + Android channel. Safe to call repeatedly. */
export async function configure(): Promise<void> {
  if (configured) return;
  configured = true;
  try {
    // Show the alert even when the app is in the foreground.
    Notifications.setNotificationHandler({
      // Field names vary across expo-notifications versions; include all and
      // cast so this compiles regardless of the installed minor.
      handleNotification: async () =>
        ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        } as any),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'Disaster Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#DC2626',
      });
    }
  } catch (err) {
    console.warn('[notificationService.configure] failed:', err);
  }
}

/**
 * Request OS notification permission. Returns true if granted.
 * Android local notifications are granted by default; iOS requires this prompt.
 */
export async function requestPermissions(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch (err) {
    console.warn('[notificationService.requestPermissions] failed:', err);
    return false;
  }
}

/**
 * Register this device for REMOTE push (wakes a closed app).
 *
 * Fetches the native FCM (Android) / APNs (iOS) handle via
 * getDevicePushTokenAsync() and sends it — with the device's current location —
 * to the backend, which routes it through Azure Notification Hubs on a disaster.
 *
 * Requires a dev/production build with FCM/APNs configured; in Expo Go the
 * native handle is unavailable, so this no-ops gracefully (local notifications
 * still work). Best-effort: never throws.
 *
 * @param loc the device's current location, so the server can radius-target it
 */
export async function registerForRemotePush(
  loc?: { lat: number; lng: number } | null
): Promise<boolean> {
  try {
    const granted = await requestPermissions();
    if (!granted) return false;

    // Native device handle (FCM/APNs). Throws in Expo Go / web — caught below.
    const deviceToken = await Notifications.getDevicePushTokenAsync();
    const raw = (deviceToken as { data?: unknown })?.data;
    if (!raw || typeof raw !== 'string') return false;

    const platform: 'ios' | 'android' | 'expo' =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'expo';

    return await registerDeviceToken({
      token: raw,
      platform,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
    });
  } catch (err) {
    // Expo Go (no native handle), denied permission, or offline — all non-fatal.
    console.warn('[notificationService.registerForRemotePush] skipped:', err);
    return false;
  }
}

/**
 * Subscribe to notification TAPS (foreground, background, and cold-start).
 *
 * When a remote/local disaster push is tapped the OS launches/foregrounds the
 * app; this surfaces the `disasterId` carried in the payload so the caller can
 * route the user straight into the disaster-mode gate instead of waiting for the
 * next radius recompute.
 *
 * @param handler receives the disasterId from the tapped notification (or null)
 * @returns an unsubscribe function
 */
export function addDisasterTapListener(
  handler: (disasterId: string | null, type: string | null) => void
): () => void {
  try {
    const extract = (
      response: Notifications.NotificationResponse | null
    ): { id: string | null; type: string | null } => {
      const data = response?.notification?.request?.content?.data as
        | { disasterId?: string; type?: string }
        | undefined;
      return { id: data?.disasterId ?? null, type: data?.type ?? null };
    };

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const { id, type } = extract(response);
      handler(id, type);
    });

    // Cold start: the app may have been launched by tapping a push while closed.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          const { id, type } = extract(response);
          handler(id, type);
        }
      })
      .catch(() => {});

    return () => sub.remove();
  } catch (err) {
    console.warn('[notificationService.addDisasterTapListener] failed:', err);
    return () => {};
  }
}

/**
 * Present a local notification telling the user a CONFIRMED loved one is inside
 * an affected zone. Distinct from notifyDisaster: it is typed `loved_one_alert`
 * so tapping it never drives the recipient into disaster mode (only the affected
 * person enters that) — it just surfaces the person's status.
 */
export async function notifyLovedOne(affectedName: string, disaster: Disaster): Promise<void> {
  try {
    const who = affectedName || 'A loved one';
    const type = (disaster.type || 'disaster').toLowerCase();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `⚠️ ${who} may be in an affected area`,
        body: `A ${type} alert covers ${who}'s area. Open Report Safe to see their status.`,
        sound: true,
        data: { disasterId: disaster.id, type: 'loved_one_alert', affectedName: who },
        ...(Platform.OS === 'android' ? { vibrate: [0, 200, 100, 200] } : {}),
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('[notificationService.notifyLovedOne] failed:', err);
  }
}

/** Present an immediate local notification for an activated disaster. */
export async function notifyDisaster(disaster: Disaster): Promise<void> {
  try {
    const type = (disaster.type || 'Disaster').replace(/^\w/, (c) => c.toUpperCase());
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `⚠️ ${type} alert — you are in the affected area`,
        body:
          disaster.description ||
          'A disaster has been declared in your area. Open Report Safe and confirm your safety now.',
        sound: true,
        ...(Platform.OS === 'android' ? { vibrate: [0, 250, 250, 250] } : {}),
      },
      trigger: null, // deliver immediately
    });
  } catch (err) {
    console.warn('[notificationService.notifyDisaster] failed:', err);
  }
}

export const notificationService = {
  configure,
  requestPermissions,
  registerForRemotePush,
  addDisasterTapListener,
  notifyDisaster,
  notifyLovedOne,
  ANDROID_CHANNEL_ID,
};
