import NetInfo from '@react-native-community/netinfo';

/**
 * Watches network connectivity via NetInfo and triggers outbox delivery the
 * moment internet returns. This is the heart of "deliver the instant any path
 * becomes available".
 *
 * NOTE: We import attemptDelivery lazily inside the handler to avoid a static
 * circular import between this module and syncService.
 */

let unsubscribe: (() => void) | null = null;
let lastConnected = false;

/**
 * Resolve the current connectivity state as a boolean.
 */
export async function isConnected(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch (err) {
    console.error('[connectivityWatcher.isConnected] NetInfo.fetch failed:', err);
    return false;
  }
}

/**
 * Begin listening for connectivity changes. Call once on app mount.
 * On every transition into a connected state, flushes the outbox.
 */
export function startWatching(): void {
  if (unsubscribe) return;
  unsubscribe = NetInfo.addEventListener((state) => {
    const connected = Boolean(
      state.isConnected && state.isInternetReachable !== false
    );
    // Only act on the rising edge (offline -> online).
    if (connected && !lastConnected) {
      // Lazy import breaks the circular dependency with syncService.
      import('./syncService')
        .then(({ attemptDelivery }) => attemptDelivery())
        .catch((err) =>
          console.error(
            '[connectivityWatcher] failed to flush outbox on reconnect:',
            err
          )
        );
    }
    lastConnected = connected;
  });
}

/**
 * Stop listening (e.g. on app teardown).
 */
export function stopWatching(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

export const connectivityWatcher = { isConnected, startWatching, stopWatching };
