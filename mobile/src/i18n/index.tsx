/**
 * Report Safe — Mobile i18n (English ⇄ Traditional Chinese).
 *
 * A tiny React Context drives a `t(key)` lookup against ./messages. The chosen
 * locale is persisted synchronously via `userStorage` (SQLite on device,
 * localStorage on web) so the very first render already uses the saved language
 * — no flash of English. `useTranslation()` exposes `t`, `locale`, `setLocale`
 * and `toggleLocale`; changing the locale re-renders every consumer.
 */
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { userStorage } from '../db/userStorage';
import { messages, type Locale } from './messages';
import { severityBucket } from '../utils/severity';

const STORAGE_KEY = 'rs_lang';
const SUPPORTED: Locale[] = ['en', 'zh'];

function initialLocale(): Locale {
  try {
    const saved = userStorage.get(STORAGE_KEY) as Locale | null;
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch { /* storage may be unavailable */ }
  return 'en';
}

/** Resolve `ns.key` against a locale tree, returning undefined if absent. */
function resolve(locale: Locale, key: string): string | undefined {
  const dot = key.indexOf('.');
  if (dot === -1) return undefined;
  const ns = messages[locale]?.[key.slice(0, dot)];
  return ns?.[key.slice(dot + 1)];
}

function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let str = resolve(locale, key);
  if (str === undefined) str = resolve('en', key);
  if (str === undefined) return key;
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (_, name) =>
      params[name] !== undefined && params[name] !== null ? String(params[name]) : `{${name}}`);
  }
  return str;
}

/** The persisted locale — usable outside React (e.g. the notification service). */
export function currentLocale(): Locale {
  try {
    const saved = userStorage.get(STORAGE_KEY) as Locale | null;
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch { /* storage may be unavailable */ }
  return 'en';
}

/** Translate outside React, defaulting to the persisted locale. */
export function translateStandalone(
  key: string,
  params?: Record<string, string | number>,
  locale: Locale = currentLocale(),
): string {
  return translate(locale, key, params);
}

/** Localized disaster-type label, usable outside React. */
export function disasterTypeLabelStandalone(type: string | null | undefined, locale: Locale = currentLocale()): string {
  const key = (type || '').toLowerCase();
  const found = resolve(locale, `disasterType.${key}`) ?? resolve('en', `disasterType.${key}`);
  return found ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : '');
}

/** Localized incident-type label (CFR), usable outside React. */
export function incidentTypeLabelStandalone(type: string | null | undefined, locale: Locale = currentLocale()): string {
  const key = (type || '').toLowerCase();
  const found = resolve(locale, `incidentType.${key}`) ?? resolve('en', `incidentType.${key}`);
  return found ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : '');
}

export interface I18n {
  locale: Locale;
  t: (key: string, params?: Record<string, string | number>) => string;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
  /** Status key → localized label (falls back to a humanised raw value). */
  statusLabel: (s: string | null | undefined) => string;
  /** Disaster type → localized label (falls back to Capitalised raw type). */
  disasterTypeLabel: (type: string | null | undefined) => string;
  /** Severity (number OR string label) → localized label. */
  severityLabel: (s: number | string | null | undefined) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    if (!SUPPORTED.includes(next)) return;
    setLocaleState(next);
    try { userStorage.set(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const value = useMemo<I18n>(() => {
    const t = (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
    return {
      locale,
      t,
      setLocale,
      toggleLocale: () => setLocale(locale === 'en' ? 'zh' : 'en'),
      statusLabel: (s) => {
        if (!s) return '';
        const found = resolve(locale, `status.${s}`) ?? resolve('en', `status.${s}`);
        return found ?? s.replace(/_/g, ' ');
      },
      disasterTypeLabel: (type) => {
        const key = (type || '').toLowerCase();
        const found = resolve(locale, `disasterType.${key}`) ?? resolve('en', `disasterType.${key}`);
        return found ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : '');
      },
      severityLabel: (s) => t(`severity.${severityBucket(s)}`),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Access the translation API. Falls back to a no-Provider default (English) so
 * a component rendered outside the provider never crashes — handy for tests.
 */
export function useTranslation(): I18n {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);
  return {
    locale: 'en',
    t,
    setLocale: () => {},
    toggleLocale: () => {},
    statusLabel: (s) => (s ? (resolve('en', `status.${s}`) ?? s.replace(/_/g, ' ')) : ''),
    disasterTypeLabel: (type) =>
      (type ? resolve('en', `disasterType.${type.toLowerCase()}`) ?? (type.charAt(0).toUpperCase() + type.slice(1)) : ''),
    severityLabel: (s) => t(`severity.${severityBucket(s)}`),
  };
}
