import { onMounted, onUnmounted, ref } from 'vue';

/**
 * useLiveQuery(fetcher, { invalidateOn, pollMs }) — declarative "fetch + keep fresh".
 *
 * - fetches once on mount (loud: flips `loading`);
 * - re-fetches silently (no `loading` flip) whenever any socket subscription in
 *   `invalidateOn` fires. Entries are the on* helpers from socket.js — functions
 *   of shape (cb) => unsubscribe — e.g. useSocket().onStatsUpdate;
 * - optional `pollMs` re-fetches silently on an interval;
 * - a monotonic in-flight guard: only the most recently started fetch may commit
 *   its result, so a stale slow HTTP response can never overwrite data from a
 *   newer refresh (this replaces per-view socket-vs-HTTP race patches).
 *
 * Returns { data, loading, error, refresh }. `refresh()` is the loud variant for
 * user-initiated reloads (mount-equivalent); background triggers stay silent so
 * pollers don't flash spinners.
 */
export function useLiveQuery(fetcher, { invalidateOn = [], pollMs = null } = {}) {
  const data = ref(null);
  const loading = ref(false);
  const error = ref(null);

  let seq = 0; // monotonic ticket — bumping it invalidates every in-flight fetch

  async function run(silent) {
    const ticket = ++seq;
    if (!silent) loading.value = true;
    error.value = null;
    try {
      const result = await fetcher();
      if (ticket === seq) data.value = result;
    } catch (e) {
      if (ticket === seq) error.value = e;
    } finally {
      if (ticket === seq) loading.value = false;
    }
  }

  function refresh() {
    return run(false);
  }

  const unsubscribes = [];
  let pollTimer = null;

  onMounted(() => {
    run(false);
    for (const subscribe of invalidateOn) {
      unsubscribes.push(subscribe(() => run(true)));
    }
    if (pollMs) pollTimer = setInterval(() => run(true), pollMs);
  });

  onUnmounted(() => {
    seq++; // discard anything still in flight
    for (const off of unsubscribes) off?.();
    unsubscribes.length = 0;
    if (pollTimer) clearInterval(pollTimer);
  });

  return { data, loading, error, refresh };
}
