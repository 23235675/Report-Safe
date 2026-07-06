import { watch, onBeforeUnmount, nextTick } from 'vue';

/**
 * useFocusTrap — WCAG 2.4.3 focus management for modal dialogs.
 *
 * While `active` is truthy: Tab / Shift+Tab cycle within `containerRef`,
 * Escape calls `onEscape`, focus moves into the dialog when it opens and
 * returns to the previously-focused element when it closes.
 *
 * The container element must carry `tabindex="-1"` so it can take initial
 * focus (the dialog's aria-labelledby heading is then announced).
 *
 * @param {import('vue').Ref<HTMLElement|null>} containerRef - the dialog element
 * @param {import('vue').Ref<boolean>|(() => boolean)} active - open state
 * @param {() => void} [onEscape] - close callback for the Escape key
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(containerRef, active, onEscape) {
  let restoreTo = null;

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onEscape?.();
      return;
    }
    if (e.key !== 'Tab') return;
    const el = containerRef.value;
    if (!el) return;
    const items = el.querySelectorAll(FOCUSABLE);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === el || !el.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !el.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  }

  function engage() {
    restoreTo = document.activeElement;
    document.addEventListener('keydown', onKeydown, true);
    nextTick(() => {
      const el = containerRef.value;
      if (!el) return;
      (el.querySelector('[autofocus]') || el).focus();
    });
  }

  function release() {
    document.removeEventListener('keydown', onKeydown, true);
    if (restoreTo instanceof HTMLElement) restoreTo.focus();
    restoreTo = null;
  }

  watch(active, (open) => (open ? engage() : release()));
  onBeforeUnmount(release);
}
