/**
 * Report Safe — lightweight reactive i18n for the citizen/volunteer web surface.
 *
 * No dependency: a single reactive `locale` ref drives a `t(key)` lookup against
 * ./messages.js. Because `t()` reads `locale.value` while a component renders,
 * Vue tracks it automatically — switching locale re-renders every view that uses
 * `$t` / `t`. The choice is persisted to localStorage so it survives reloads.
 *
 * Usage:
 *   - Templates: `{{ $t('home.reportStatus') }}` (registered globally, see install)
 *   - Script:    `import { t, locale, toggleLocale } from '../i18n'`
 */
import { ref, readonly } from 'vue';
import { messages } from './messages.js';

const STORAGE_KEY = 'rs_lang';
export const SUPPORTED = ['en', 'zh'];

function initialLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.includes(saved)) return saved;
  } catch { /* localStorage may be unavailable */ }
  return 'en';
}

const _locale = ref(initialLocale());
export const locale = readonly(_locale);

// Keep <html lang> in sync for a11y / browser hinting.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('lang', _locale.value === 'zh' ? 'zh-Hant' : 'en');
}

export function setLocale(next) {
  if (!SUPPORTED.includes(next) || next === _locale.value) return;
  _locale.value = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', next === 'zh' ? 'zh-Hant' : 'en');
  }
}

export function toggleLocale() {
  setLocale(_locale.value === 'en' ? 'zh' : 'en');
}

/** Resolve a dotted key against a locale's message tree. */
function resolve(lang, key) {
  let node = messages[lang];
  for (const part of key.split('.')) {
    if (node == null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Translate `key` for the active locale, interpolating {tokens} from `params`.
 * Falls back to English, then to the raw key, so a missing translation never
 * blanks out the UI.
 */
export function t(key, params) {
  let str = resolve(_locale.value, key);
  if (str === undefined) str = resolve('en', key);
  if (str === undefined) return key;
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (_, name) =>
      (params[name] !== undefined && params[name] !== null) ? String(params[name]) : `{${name}}`);
  }
  return str;
}

/* ── Data-value label helpers (fall back to a humanised raw value) ────────── */

export function disasterTypeLabel(type) {
  const key = (type || '').toLowerCase();
  const found = resolve(_locale.value, `disasterType.${key}`) ?? resolve('en', `disasterType.${key}`);
  return found ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : '');
}

export function shelterTypeLabel(type) {
  const key = (type || '').toLowerCase();
  return resolve(_locale.value, `shelterType.${key}`) ?? resolve('en', `shelterType.${key}`) ?? (type || '');
}

export function sourceLabel(src) {
  const key = (src || 'government').toLowerCase();
  return resolve(_locale.value, `source.${key}`) ?? resolve('en', `source.${key}`) ?? key;
}

/** Map a numeric severity to its label key ('minor' | 'moderate' | 'severe' | 'extreme'). */
export function severityKey(s) {
  if (!s || s < 3) return 'minor';
  if (s < 4) return 'moderate';
  if (s < 5) return 'severe';
  return 'extreme';
}

/** Composable form for components that prefer the Composition API. */
export function useI18n() {
  return { locale, t, setLocale, toggleLocale, disasterTypeLabel, shelterTypeLabel, sourceLabel, severityKey };
}

/** Vue plugin: register `$t` and `$locale` so every template can use them. */
export default {
  install(app) {
    app.config.globalProperties.$t = t;
    app.config.globalProperties.$locale = locale;
  },
};
