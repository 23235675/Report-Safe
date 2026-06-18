import { ref, computed } from 'vue';
import { submitReport } from '../api.js';

/**
 * Offline outbox backed by localStorage with an in-memory fallback.
 *
 * Invariant: a report is enqueued locally BEFORE any network attempt, so it can
 * never be lost. Successful delivery removes it from the outbox.
 */

const STORAGE_KEY = 'report_safe_outbox';

/** True once we've detected localStorage is unusable (private mode / quota). */
let storageUnavailable = false;
/** In-memory mirror used both as cache and as fallback store. */
let memoryStore = [];

// Shared reactive list so every component using the composable stays in sync.
const items = ref([]);

/**
 * Probe localStorage once.
 * @returns {boolean}
 */
function hasLocalStorage() {
  if (storageUnavailable) return false;
  try {
    const k = '__rs_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    if (!storageUnavailable) {
      console.warn(
        '[useOutbox] localStorage unavailable — falling back to in-memory outbox. ' +
          'Reports will not survive a page reload.'
      );
    }
    storageUnavailable = true;
    return false;
  }
}

/**
 * Load the outbox from persistence into the reactive ref.
 */
function load() {
  if (hasLocalStorage()) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      items.value = raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('[useOutbox.load] failed to parse outbox:', err);
      items.value = [];
    }
  } else {
    items.value = [...memoryStore];
  }
}

/**
 * Persist the reactive ref back to storage.
 */
function persist() {
  if (hasLocalStorage()) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value));
    } catch (err) {
      console.error('[useOutbox.persist] failed to write outbox:', err);
    }
  } else {
    memoryStore = [...items.value];
  }
}

// Initial load (module-singleton).
load();

const pendingCount = computed(
  () => items.value.filter((i) => i.status === 'pending').length
);

export function useOutbox() {
  /**
   * Add a report to the outbox as pending. Idempotent on report id.
   * @param {object} report
   */
  function enqueue(report) {
    const exists = items.value.some((i) => i.id === report.id);
    if (!exists) {
      items.value.push({ ...report, status: 'pending' });
      persist();
    }
  }

  /**
   * Remove a successfully delivered report.
   * @param {string} id
   */
  function markSent(id) {
    items.value = items.value.filter((i) => i.id !== id);
    persist();
  }

  /**
   * @returns {Array<object>} all pending reports
   */
  function getPending() {
    return items.value.filter((i) => i.status === 'pending');
  }

  /**
   * Attempt to deliver every pending report. Marks each as sent on success.
   * @returns {Promise<{delivered:number, remaining:number}>}
   */
  async function retryAll() {
    let delivered = 0;
    for (const report of getPending()) {
      try {
        await submitReport(report);
        markSent(report.id);
        delivered++;
      } catch (err) {
        // A 4xx means the server received it and permanently refused (bad data) —
        // retrying never succeeds, so drop it instead of clogging the queue
        // forever. Only transient failures (offline / 5xx) stay queued.
        if (err?.status >= 400 && err?.status < 500) {
          console.warn('[useOutbox.retryAll] dropping permanently-rejected report:', err.message);
          markSent(report.id);
        } else {
          console.error('[useOutbox.retryAll] delivery failed, keeping queued:', err);
        }
      }
    }
    return { delivered, remaining: pendingCount.value };
  }

  return {
    items,
    enqueue,
    markSent,
    getPending,
    retryAll,
    pendingCount,
    storageUnavailable: () => storageUnavailable,
  };
}
