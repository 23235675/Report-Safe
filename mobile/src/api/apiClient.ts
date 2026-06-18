/**
 * Typed fetch wrapper for the Report Safe backend.
 * EXPO_PUBLIC_API_URL for physical devices (e.g. http://192.168.1.10:3001).
 */

import { userStorage } from '../db/userStorage';

// Full status set — kept in sync with the server (server/src/lib/zodSchemas.js).
export type ReportStatus =
  | 'safe'
  | 'injured'
  | 'need_help'
  | 'awaiting_response'
  | 'potentially_missing'
  | 'missing'
  | 'verified_missing'
  | 'rescued'
  | 'deceased';

export interface PendingReport {
  id:            string;
  name:          string;
  status:        ReportStatus;
  lat:           number;
  lng:           number;
  medical_notes?: string | null;
  phone?:         string | null;
  /** Normalised HKID — mandatory in the form; nullable for legacy queued reports. */
  personal_id?:  string | null;
  created_at:    number;
  disaster_id?:  string | null;
  reported_by?:  'self' | 'family' | null;
  reporter_name?: string | null;
  user_type?:    'mobile' | 'web';
}

export interface CivilianReport {
  id:            string;
  name:          string;
  /** null = registered person with no report yet (search now hits the users dir). */
  status:        ReportStatus | null;
  updated_at:    number | null;
  coarse_lat:    number | null;
  coarse_lng:    number | null;
  /** Masked phone for public display, e.g. "····4567". */
  phone_masked?: string | null;
  reported_by?:  string | null;
  reporter_name?: string | null;
}

export interface Stats {
  total:               number;
  safe:                number;
  injured:             number;
  need_help:           number;
  awaiting_response:   number;
  potentially_missing: number;
  missing:             number;
  verified_missing:    number;
  rescued:             number;
  deceased:            number;
  active_disasters:    number;
}

export interface Disaster {
  id:          string;
  type:        string;
  magnitude:   number | null;
  severity:    number | null;
  lat:         number;
  lng:         number;
  radius_km:   number;
  description: string | null;
  started_at:  number;
  ended_at:    number | null;
  active:      boolean;
}

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * fetch() with an AbortController timeout so a stalled/half-open connection
 * can't hang a submit forever (the outbox already guarantees retry).
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Submit a report. Returns `status` so callers can distinguish a PERMANENT
 * rejection (4xx — bad data, don't retry) from a TRANSIENT failure (offline/5xx —
 * keep queued). Mirrors the web ReportView / outbox logic.
 */
export async function submitReport(
  report: PendingReport
): Promise<{ ok: boolean; id?: string; status?: number; error?: string }> {
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    let body: any = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) return { ok: false, status: res.status, error: body?.error };
    return { ok: true, id: body?.id };
  } catch {
    return { ok: false }; // network error → no status → transient
  }
}

export async function searchByName(q: string): Promise<CivilianReport[]> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/reports/search?q=${encodeURIComponent(q)}`
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { results?: CivilianReport[] };
    return body.results ?? [];
  } catch {
    return [];
  }
}

export async function getStats(): Promise<Stats> {
  const fallback: Stats = {
    total: 0, safe: 0, injured: 0, need_help: 0,
    awaiting_response: 0, potentially_missing: 0, missing: 0,
    verified_missing: 0, rescued: 0, deceased: 0, active_disasters: 0,
  };
  try {
    const res  = await fetchWithTimeout(`${API_BASE_URL}/api/reports/stats`);
    if (!res.ok) return fallback;
    const body = (await res.json()) as { stats?: Stats };
    return body.stats ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getDisasters(): Promise<Disaster[]> {
  try {
    const res  = await fetchWithTimeout(`${API_BASE_URL}/api/disasters`);
    if (!res.ok) return [];
    const body = (await res.json()) as { disasters?: Disaster[] };
    return body.disasters ?? [];
  } catch {
    return [];
  }
}

/**
 * Register this device's native push handle + last known location so the server
 * can wake a CLOSED app with a remote disaster push (Azure Notification Hubs).
 * Best-effort: failure must never disrupt the app.
 */
export async function registerDeviceToken(payload: {
  token: string;
  platform: 'ios' | 'android' | 'expo';
  lat?: number | null;
  lng?: number | null;
}): Promise<boolean> {
  try {
    // Send the user's Bearer token when we have one so the server links this
    // device handle to the account (device_push_tokens.user_id). That linkage is
    // what lets the loved-one cascade find a relative's phone to push to.
    const auth = getAccessToken();
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ── Auth session (per-user access + refresh tokens) ─────────────────────────
 * Issued at registration (AccountScreen). Stored on-device so the app can call
 * its own user-scoped endpoints (account links). Mirrors web/src/api.js.
 */
const ACCESS_KEY  = 'rs_access_token';
const REFRESH_KEY = 'rs_refresh_token';
const USER_KEY    = 'rs_user';

export function setAuthSession(s: { access_token?: string | null; refresh_token?: string | null }): void {
  try {
    if (s.access_token)  userStorage.set(ACCESS_KEY, s.access_token);
    if (s.refresh_token) userStorage.set(REFRESH_KEY, s.refresh_token);
  } catch { /* best-effort */ }
}
export function clearAuthSession(): void {
  try { userStorage.remove(ACCESS_KEY); userStorage.remove(REFRESH_KEY); } catch { /* ignore */ }
}
function getAccessToken(): string | null {
  try { return userStorage.get(ACCESS_KEY); } catch { return null; }
}
function getRefreshToken(): string | null {
  try { return userStorage.get(REFRESH_KEY); } catch { return null; }
}
/** The logged-in user's id, read from the stored profile (or null if no account). */
export function currentUserId(): string | null {
  try {
    const raw = userStorage.get(USER_KEY);
    return raw ? (JSON.parse(raw)?.id ?? null) : null;
  } catch { return null; }
}

/** The full stored user profile (or null). */
export function getCurrentUser(): any | null {
  try {
    const raw = userStorage.get(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** This user's role (citizen | volunteer | government | super_admin), or null. */
export function currentUserRole(): string | null {
  return getCurrentUser()?.role ?? null;
}

/** True for gov/volunteer users who may manage shelters + moderate safe places. */
export function canManageFacilities(): boolean {
  return ['volunteer', 'government'].includes(currentUserRole() || '');
}

/** Create an account → returns { user, access_token, refresh_token }. Throws on failure. */
export async function registerUser(payload: {
  phone: string; name: string; personal_id?: string | null;
  email?: string | null; privacy_consent: boolean; user_type?: 'mobile' | 'web';
}): Promise<any> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err: any = new Error(body?.error || `Registration failed: ${res.status}`);
    err.status = res.status;
    err.details = body?.details;
    throw err;
  }
  return body;
}

/**
 * Phone-only login for an EXISTING account → returns { user, access_token, refresh_token }.
 * Same contract as web loginUser. Throws on failure (err.status set).
 */
export async function loginUser(phone: string): Promise<any> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err: any = new Error(body?.error || `Login failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** Exchange the stored refresh token for a fresh access+refresh pair. */
async function refreshAccessToken(): Promise<boolean> {
  const refresh_token = getRefreshToken();
  if (!refresh_token) return false;
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/users/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) { clearAuthSession(); return false; }
    setAuthSession(await res.json());
    return true;
  } catch { return false; }
}

/** Authenticated JSON request with one transparent refresh-and-retry on expiry. */
async function authedRequest(path: string, options: RequestInit = {}, retried = false): Promise<any> {
  const token = getAccessToken();
  const res = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    if (res.status === 401 && body?.code === 'token_expired' && token && !retried) {
      if (await refreshAccessToken()) return authedRequest(path, options, true);
    }
    const err: any = new Error(body?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.code = body?.code;
    throw err;
  }
  return body;
}

/* ── Account links ("loved ones") ──────────────────────────────────────────── */

export interface LovedOne {
  link_id:           string;
  link_status:       'pending' | 'confirmed';
  is_incoming:       boolean;   // a pending request awaiting THIS user's confirmation
  confirmed_at:      number | null;
  user_id:           string;
  phone:             string;
  name:              string | null;
  report_status:     ReportStatus | null; // only present for confirmed links
  status_updated_at: number | null;
  disaster_id:       string | null;
}

/** All of this user's loved-one links (confirmed + pending). Empty if no account. */
export async function listLovedOnes(): Promise<LovedOne[]> {
  const uid = currentUserId();
  if (!uid) return [];
  const body = await authedRequest(`/api/users/${uid}/links`);
  return body.links ?? [];
}

/** Send a link request to another registered user by phone (they must confirm). */
export async function addLovedOne(targetPhone: string): Promise<void> {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first to add loved ones.');
  await authedRequest(`/api/users/${uid}/links`, {
    method: 'POST',
    body: JSON.stringify({ target_phone: targetPhone }),
  });
}

/** Accept an incoming pending link request. */
export async function confirmLovedOne(linkId: string): Promise<void> {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first.');
  await authedRequest(`/api/users/${uid}/links/${linkId}`, { method: 'PUT' });
}

/** Remove a link (confirmed or pending). */
export async function removeLovedOne(linkId: string): Promise<void> {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first.');
  await authedRequest(`/api/users/${uid}/links/${linkId}`, { method: 'DELETE' });
}

/* ── Safe places (citizen-submitted refuge locations) ──────────────────────── */

export interface SafePlace {
  id:          string;
  name:        string;
  lat:         number;
  lng:         number;
  description?: string | null;
  capacity?:   number | null;
  disaster_id?: string | null;
  created_at:  number;
  submitter_name?:  string | null;
  submitter_phone?: string | null;
}

/** Public list of APPROVED safe places. */
export async function listSafePlaces(): Promise<SafePlace[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/safe-places`);
    if (!res.ok) return [];
    const body = await res.json();
    return body.safe_places ?? [];
  } catch { return []; }
}

/** Any logged-in user (incl. citizens) can suggest a safe place (starts pending). */
export async function createSafePlace(payload: {
  name: string; lat: number; lng: number;
  description?: string | null; capacity?: number | null; disaster_id?: string | null;
}): Promise<void> {
  await authedRequest('/api/safe-places', { method: 'POST', body: JSON.stringify(payload) });
}

/** Moderation queue (gov/volunteer): safe places awaiting review. */
export async function listPendingSafePlaces(): Promise<SafePlace[]> {
  const body = await authedRequest('/api/safe-places/pending');
  return body.safe_places ?? [];
}

/** Approve or decline a pending safe place (gov/volunteer). */
export async function moderateSafePlace(id: string, status: 'approved' | 'rejected'): Promise<void> {
  await authedRequest(`/api/safe-places/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}
