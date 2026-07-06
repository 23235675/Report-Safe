/**
 * Thin fetch wrappers around the backend REST API.
 * All requests use relative URLs so Vite's dev proxy routes them to Express.
 *
 * Every endpoint is a one-liner over the single `request()` core below, which
 * owns JSON headers, the Authorization header, query-string building, the
 * transparent access-token refresh/replay, and error normalization.
 */

const BASE = import.meta.env.VITE_API_BASE_URL || '';

// H3: the access token lives in MEMORY only (never localStorage), so an XSS
// can't read it; the long-lived refresh token is an httpOnly cookie the server
// set, invisible to JS. On reload the access token is gone — initAuth() mints a
// fresh one from the cookie. (Legacy localStorage tokens are purged below.)
let accessToken = null;
try { localStorage.removeItem('rs_token'); localStorage.removeItem('rs_refresh'); } catch { /* ignore */ }

/** Store the access token from a register/login/refresh response (refresh = cookie). */
export function setAuthSession({ access_token } = {}) {
  if (access_token) accessToken = access_token;
}
export function clearAuthToken() { accessToken = null; }
function getToken() { return accessToken; }

/**
 * Exchange the httpOnly refresh cookie for a fresh access token. Same-origin, so
 * the cookie rides along automatically (no body needed). Returns false when there
 * is no valid cookie (logged out). Deliberately NOT built on request(): it must
 * send credentials and must never recurse into the refresh-and-replay path.
 */
export async function refreshAccessToken() {
  try {
    const res = await fetch(`${BASE}/api/users/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}',
    });
    if (!res.ok) { clearAuthToken(); return false; }
    const body = await res.json();
    setAuthSession(body);
    return true;
  } catch { return false; }
}

/** Restore the session on app load by minting an access token from the cookie. */
export async function initAuth() {
  return refreshAccessToken();
}

/**
 * The single request core.
 *  - method: HTTP verb (default GET)
 *  - body:   plain object (JSON-stringified) or pre-serialized string
 *  - token:  Bearer token — pass getToken() for the citizen session, a gov/admin
 *            token explicitly, or omit for anonymous calls
 *  - query:  object appended as a query string (null/undefined values skipped,
 *            like the previous per-endpoint URLSearchParams builders)
 * On 401 token_expired for an authenticated call it transparently refreshes the
 * citizen access token once and replays (new token, else the original one).
 * Errors are normalized to Error { status, code, details } — never a raw body.
 */
async function request(path, { method = 'GET', body, token, query } = {}, _retried = false) {
  let qs = '';
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, v);
    }
    qs = params.toString();
  }
  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  let resBody = null;
  try { resBody = await res.json(); } catch { resBody = null; }
  if (!res.ok) {
    // Access token expired → transparently refresh once and replay the request
    // with the new token (only when this call carried an Authorization header).
    if (res.status === 401 && resBody?.code === 'token_expired' && !!token && !_retried) {
      const ok = await refreshAccessToken();
      if (ok) {
        return request(path, { method, body, query, token: getToken() || token }, true);
      }
    }
    const err = new Error(resBody?.error || `Request failed: ${res.status}`);
    err.status  = res.status;
    err.code    = resBody?.code;
    err.details = resBody?.details;
    throw err;
  }
  return resBody;
}

// L7: the server now returns a uniform { ok, data, meta } envelope. These
// wrappers re-expose `data` under the legacy key each view already reads (and
// lift meta fields like total/next_cursor to the top level), so the API is
// uniform while the Vue views need no changes.
function reshape(body, key) {
  return { ...body, [key]: body?.data, ...(body?.meta || {}) };
}

export async function submitReport(report) {
  // C1: report writes are authenticated. Attach the user's token so the server
  // can derive identity; request() transparently refreshes once on expiry.
  // L7: expose the created id (now under data.id) as res.id for callers.
  const b = await request('/api/reports', { method: 'POST', token: getToken(), body: report });
  return { ...b, id: b?.data?.id };
}

export async function searchByName(q) {
  return reshape(await request(`/api/reports/search?q=${encodeURIComponent(q)}`), 'results');
}

export async function getPeople({ limit = 50, offset = 0, status = null } = {}) {
  const q = `/api/reports/people?limit=${limit}&offset=${offset}${status ? `&status=${encodeURIComponent(status)}` : ''}`;
  return reshape(await request(q), 'people');
}

export async function getRescueView(lat, lng, radius, token) {
  return reshape(await request(`/api/reports/rescue?lat=${lat}&lng=${lng}&radius=${radius}`, { token }), 'results');
}

export async function getStats({ excludeWeb = false } = {}) {
  return reshape(await request(`/api/reports/stats${excludeWeb ? '?exclude_web=true' : ''}`), 'stats');
}

export async function getDisasters() {
  return reshape(await request('/api/disasters'), 'disasters');
}

/* ── Community First Responder (CFR) — gov dispatcher console ───────────────── */

/** Dispatch a 999/CAD incident (the integration seam; gov token). */
export async function createIncident(payload, token) {
  return request('/api/incidents', { method: 'POST', token, body: payload });
}

/** Live dispatcher board — active incidents + per-incident responder counts. */
export async function getActiveIncidents(token) {
  return reshape(await request('/api/incidents/active', { token }), 'incidents');
}

/** Resolve / stand down an incident (gov token). */
export async function resolveIncident(id, token, status = 'resolved') {
  return request(`/api/incidents/${id}/resolve`, { method: 'POST', token, body: { status } });
}

export async function getShelters({ lat, lng, radius, disaster_id, source } = {}) {
  return reshape(await request('/api/shelters', { query: { lat, lng, radius, disaster_id: disaster_id || undefined, source: source || undefined } }), 'shelters');
}

export async function createShelter(payload, token) {
  return request('/api/shelters', { method: 'POST', token, body: payload });
}

export async function updateShelter(id, payload, token) {
  return request(`/api/shelters/${id}`, { method: 'PUT', token, body: payload });
}

export async function deleteShelter(id, token) {
  return request(`/api/shelters/${id}`, { method: 'DELETE', token });
}

export async function registerUser(payload) {
  return request('/api/users/register', { method: 'POST', body: payload });
}

/** Phone-only login for an existing account → returns user + token pair. */
export async function loginUser(phone) {
  return request('/api/users/login', { method: 'POST', body: { phone } });
}

/* ── Safe places (citizen-submitted refuge locations) ──────────────────────── */

export async function listSafePlaces({ lat, lng, radius } = {}) {
  return reshape(await request('/api/safe-places', { query: { lat, lng, radius } }), 'safe_places');
}

/** Any logged-in user (incl. citizens) can suggest a safe place. */
export async function createSafePlace(payload) {
  return request('/api/safe-places', { method: 'POST', token: getToken(), body: payload });
}

/** Moderation queue — pending safe places awaiting gov/volunteer review. */
export async function listPendingSafePlaces(token) {
  return reshape(await request('/api/safe-places/pending', { token }), 'safe_places');
}

/** Approve or decline a pending safe place (gov/volunteer). status: 'approved'|'rejected'. */
export async function moderateSafePlace(id, status, token) {
  return request(`/api/safe-places/${id}/status`, { method: 'PUT', token, body: { status } });
}

export async function getUserProfile(phone) {
  return reshape(await request(`/api/users/${encodeURIComponent(phone)}/profile`, { token: getToken() }), 'user');
}

/* ── Account links ("loved ones") ──────────────────────────────────────────── */

const USER_KEY = 'rs_user';
/** The logged-in user's id, read from the stored profile (or null if no account). */
export function currentUserId() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw)?.id ?? null) : null;
  } catch { return null; }
}

/** The full stored user profile (or null). Used to read the role. */
export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** The logged-in user's personal access token (rs_token), or null. */
export function getUserToken() { return getToken(); }

/** This user's loved-one links (confirmed + pending). Empty when no account. */
export async function listLovedOnes() {
  const uid = currentUserId();
  if (!uid) return { ok: true, links: [] };
  return reshape(await request(`/api/users/${uid}/links`, { token: getToken() }), 'links');
}

/** Send a link request to another registered user by phone (they must confirm). */
export async function addLovedOne(target_phone) {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first to add loved ones.');
  return request(`/api/users/${uid}/links`, { method: 'POST', token: getToken(), body: { target_phone } });
}

/** Accept an incoming pending link request. */
export async function confirmLovedOne(link_id) {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first.');
  return request(`/api/users/${uid}/links/${link_id}`, { method: 'PUT', token: getToken() });
}

/** Remove a link (confirmed or pending). */
export async function removeLovedOne(link_id) {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first.');
  return request(`/api/users/${uid}/links/${link_id}`, { method: 'DELETE', token: getToken() });
}

/* ── Super-admin API ────────────────────────────────────────────────────────── */

const ADMIN_TOKEN_KEY = 'rs_admin_token';
const ADMIN_USER_KEY  = 'rs_admin_user';

export function getAdminToken()  { try { return sessionStorage.getItem(ADMIN_TOKEN_KEY); }        catch { return null; } }
export function getAdminUser()   { try { return JSON.parse(sessionStorage.getItem(ADMIN_USER_KEY)); } catch { return null; } }
export function setAdminSession({ access_token, user } = {}) {
  try {
    if (access_token) sessionStorage.setItem(ADMIN_TOKEN_KEY, access_token);
    if (user)         sessionStorage.setItem(ADMIN_USER_KEY,  JSON.stringify(user));
  } catch { /* ignore */ }
}
export function clearAdminSession() {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    sessionStorage.removeItem(ADMIN_USER_KEY);
  } catch { /* ignore */ }
}

/** request() with the stored super-admin bearer token attached. */
function adminRequest(path, options = {}) {
  return request(path, { token: getAdminToken(), ...options });
}

export async function adminLogin(phone, password) {
  return request('/api/admin/login', { method: 'POST', body: { phone, password } });
}

// L7: admin list endpoints return { ok, data, meta }; re-expose data as `rows`
// and lift meta.total / meta.next_cursor so AdminView (res.rows / res.total) is
// unchanged. adminGetStats returns the stats object directly.
export async function adminGetStats()          { return (await adminRequest('/api/admin/stats')).data; }
export async function adminGetAudit(params = {}) { return reshape(await adminRequest('/api/admin/audit', { query: params }), 'rows'); }

// Users
export async function adminListUsers(params = {}) { return reshape(await adminRequest('/api/admin/users', { query: params }), 'rows'); }
export async function adminCreateUser(data)     { return adminRequest('/api/admin/users', { method: 'POST', body: data }); }
export async function adminUpdateUser(id, data) { return adminRequest(`/api/admin/users/${id}`, { method: 'PUT', body: data }); }
export async function adminDeleteUser(id)       { return adminRequest(`/api/admin/users/${id}`, { method: 'DELETE' }); }

// Reports
export async function adminListReports(params = {}) { return reshape(await adminRequest('/api/admin/reports', { query: params }), 'rows'); }
export async function adminCreateReport(data)     { return adminRequest('/api/admin/reports', { method: 'POST', body: data }); }
export async function adminUpdateReport(id, data) { return adminRequest(`/api/admin/reports/${id}`, { method: 'PUT', body: data }); }
export async function adminDeleteReport(id)       { return adminRequest(`/api/admin/reports/${id}`, { method: 'DELETE' }); }

// Disasters
export async function adminListDisasters(params = {}) { return reshape(await adminRequest('/api/admin/disasters', { query: params }), 'rows'); }
export async function adminCreateDisaster(data)         { return adminRequest('/api/admin/disasters', { method: 'POST', body: data }); }
export async function adminUpdateDisaster(id, data)     { return adminRequest(`/api/admin/disasters/${id}`, { method: 'PUT', body: data }); }
export async function adminDeleteDisaster(id)           { return adminRequest(`/api/admin/disasters/${id}`, { method: 'DELETE' }); }

// Links
export async function adminListLinks(params = {}) { return reshape(await adminRequest('/api/admin/links', { query: params }), 'rows'); }
export async function adminUpdateLink(id, data) { return adminRequest(`/api/admin/links/${id}`, { method: 'PUT', body: data }); }
export async function adminDeleteLink(id)       { return adminRequest(`/api/admin/links/${id}`, { method: 'DELETE' }); }

// Devices
export async function adminListDevices(params = {}) { return reshape(await adminRequest('/api/admin/devices', { query: params }), 'rows'); }
export async function adminDeleteDevice(id) { return adminRequest(`/api/admin/devices/${id}`, { method: 'DELETE' }); }
