/**
 * Thin fetch wrappers around the backend REST API.
 * All requests use relative URLs so Vite's dev proxy routes them to Express.
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
function authHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Exchange the httpOnly refresh cookie for a fresh access token. Same-origin, so
 * the cookie rides along automatically (no body needed). Returns false when there
 * is no valid cookie (logged out).
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

async function request(path, options = {}, _retried = false) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    // Access token expired → transparently refresh once and replay the request
    // with the new token (only when this call carried an Authorization header).
    const sentAuth = !!(options.headers && options.headers.Authorization);
    if (res.status === 401 && body?.code === 'token_expired' && sentAuth && !_retried) {
      const ok = await refreshAccessToken();
      if (ok) {
        const retryHeaders = { ...(options.headers || {}), ...authHeader() };
        return request(path, { ...options, headers: retryHeaders }, true);
      }
    }
    const err = new Error(body?.error || `Request failed: ${res.status}`);
    err.status  = res.status;
    err.code    = body?.code;
    err.details = body?.details;
    throw err;
  }
  return body;
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
  const b = await request('/api/reports', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(report),
  });
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
  return reshape(await request(
    `/api/reports/rescue?lat=${lat}&lng=${lng}&radius=${radius}`,
    { headers: { Authorization: `Bearer ${token}` } }
  ), 'results');
}

export async function getStats({ excludeWeb = false } = {}) {
  return reshape(await request(`/api/reports/stats${excludeWeb ? '?exclude_web=true' : ''}`), 'stats');
}

export async function getDisasters() {
  return reshape(await request('/api/disasters'), 'disasters');
}

export async function triggerDisaster(payload, token) {
  return request('/api/disasters/trigger', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

/* ── Community First Responder (CFR) — gov dispatcher console ───────────────── */

/** Dispatch a 999/CAD incident (the integration seam; gov token). */
export async function createIncident(payload, token) {
  return request('/api/incidents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

/** Live dispatcher board — active incidents + per-incident responder counts. */
export async function getActiveIncidents(token) {
  return reshape(await request('/api/incidents/active', {
    headers: { Authorization: `Bearer ${token}` },
  }), 'incidents');
}

/** Resolve / stand down an incident (gov token). */
export async function resolveIncident(id, token, status = 'resolved') {
  return request(`/api/incidents/${id}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
}

export async function getShelters({ lat, lng, radius, disaster_id, source } = {}) {
  const params = new URLSearchParams();
  if (lat != null)        params.set('lat', lat);
  if (lng != null)        params.set('lng', lng);
  if (radius != null)     params.set('radius', radius);
  if (disaster_id)        params.set('disaster_id', disaster_id);
  if (source)             params.set('source', source);
  const qs = params.toString();
  return reshape(await request(`/api/shelters${qs ? `?${qs}` : ''}`), 'shelters');
}

export async function createShelter(payload, token) {
  return request('/api/shelters', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function updateShelter(id, payload, token) {
  return request(`/api/shelters/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

export async function deleteShelter(id, token) {
  return request(`/api/shelters/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function registerUser(payload) {
  return request('/api/users/register', { method: 'POST', body: JSON.stringify(payload) });
}

/** Phone-only login for an existing account → returns user + token pair. */
export async function loginUser(phone) {
  return request('/api/users/login', { method: 'POST', body: JSON.stringify({ phone }) });
}

/* ── Safe places (citizen-submitted refuge locations) ──────────────────────── */

export async function listSafePlaces({ lat, lng, radius } = {}) {
  const params = new URLSearchParams();
  if (lat != null) params.set('lat', lat);
  if (lng != null) params.set('lng', lng);
  if (radius != null) params.set('radius', radius);
  const qs = params.toString();
  return reshape(await request(`/api/safe-places${qs ? `?${qs}` : ''}`), 'safe_places');
}

/** Any logged-in user (incl. citizens) can suggest a safe place. */
export async function createSafePlace(payload) {
  return request('/api/safe-places', {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify(payload),
  });
}

/** Moderation queue — pending safe places awaiting gov/volunteer review. */
export async function listPendingSafePlaces(token) {
  return reshape(await request('/api/safe-places/pending', {
    headers: { Authorization: `Bearer ${token}` },
  }), 'safe_places');
}

/** Approve or decline a pending safe place (gov/volunteer). status: 'approved'|'rejected'. */
export async function moderateSafePlace(id, status, token) {
  return request(`/api/safe-places/${id}/status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  });
}

export async function getUserProfile(phone) {
  return reshape(await request(`/api/users/${encodeURIComponent(phone)}/profile`, { headers: authHeader() }), 'user');
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
  return reshape(await request(`/api/users/${uid}/links`, { headers: authHeader() }), 'links');
}

/** Send a link request to another registered user by phone (they must confirm). */
export async function addLovedOne(target_phone) {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first to add loved ones.');
  return request(`/api/users/${uid}/links`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ target_phone }),
  });
}

/** Accept an incoming pending link request. */
export async function confirmLovedOne(link_id) {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first.');
  return request(`/api/users/${uid}/links/${link_id}`, { method: 'PUT', headers: authHeader() });
}

/** Remove a link (confirmed or pending). */
export async function removeLovedOne(link_id) {
  const uid = currentUserId();
  if (!uid) throw new Error('Set up your account first.');
  return request(`/api/users/${uid}/links/${link_id}`, { method: 'DELETE', headers: authHeader() });
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

function adminHeader() {
  const t = getAdminToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function adminRequest(path, options = {}) {
  return request(path, { ...options, headers: { ...adminHeader(), ...(options.headers || {}) } });
}

export async function adminLogin(phone, password) {
  return request('/api/admin/login', { method: 'POST', body: JSON.stringify({ phone, password }) });
}

// L7: admin list endpoints return { ok, data, meta }; re-expose data as `rows`
// and lift meta.total / meta.next_cursor so AdminView (res.rows / res.total) is
// unchanged. adminGetStats returns the stats object directly.
export async function adminGetStats()     { return (await adminRequest('/api/admin/stats')).data; }
export async function adminGetAudit(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return reshape(await adminRequest(`/api/admin/audit${qs ? `?${qs}` : ''}`), 'rows');
}

// Users
export async function adminListUsers(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return reshape(await adminRequest(`/api/admin/users${qs ? `?${qs}` : ''}`), 'rows');
}
export async function adminCreateUser(data)     { return adminRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }); }
export async function adminUpdateUser(id, data) { return adminRequest(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function adminDeleteUser(id)       { return adminRequest(`/api/admin/users/${id}`, { method: 'DELETE' }); }

// Reports
export async function adminListReports(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return reshape(await adminRequest(`/api/admin/reports${qs ? `?${qs}` : ''}`), 'rows');
}
export async function adminCreateReport(data)     { return adminRequest('/api/admin/reports', { method: 'POST', body: JSON.stringify(data) }); }
export async function adminUpdateReport(id, data) { return adminRequest(`/api/admin/reports/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function adminDeleteReport(id)       { return adminRequest(`/api/admin/reports/${id}`, { method: 'DELETE' }); }

// Disasters
export async function adminListDisasters(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return reshape(await adminRequest(`/api/admin/disasters${qs ? `?${qs}` : ''}`), 'rows');
}
export async function adminCreateDisaster(data)         { return adminRequest('/api/admin/disasters', { method: 'POST', body: JSON.stringify(data) }); }
export async function adminUpdateDisaster(id, data)     { return adminRequest(`/api/admin/disasters/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function adminDeleteDisaster(id)           { return adminRequest(`/api/admin/disasters/${id}`, { method: 'DELETE' }); }

// Links
export async function adminListLinks(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return reshape(await adminRequest(`/api/admin/links${qs ? `?${qs}` : ''}`), 'rows');
}
export async function adminUpdateLink(id, data) { return adminRequest(`/api/admin/links/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function adminDeleteLink(id)       { return adminRequest(`/api/admin/links/${id}`, { method: 'DELETE' }); }

// Devices
export async function adminListDevices(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return reshape(await adminRequest(`/api/admin/devices${qs ? `?${qs}` : ''}`), 'rows');
}
export async function adminDeleteDevice(id) { return adminRequest(`/api/admin/devices/${id}`, { method: 'DELETE' }); }
