/**
 * Thin fetch wrappers around the backend REST API.
 * All requests use relative URLs so Vite's dev proxy routes them to Express.
 */

const BASE = import.meta.env.VITE_API_BASE_URL || '';

// Per-user tokens (issued at registration). Access tokens EXPIRE; the refresh
// token mints a new pair via POST /api/users/token/refresh.
const TOKEN_KEY   = 'rs_token';
const REFRESH_KEY = 'rs_refresh';

export function setAuthToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } }
/** Store a full token session from a register/refresh response. */
export function setAuthSession({ access_token, refresh_token } = {}) {
  try {
    if (access_token)  localStorage.setItem(TOKEN_KEY, access_token);
    if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
  } catch { /* ignore */ }
}
export function clearAuthToken() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY); } catch { /* ignore */ }
}
function getToken()        { try { return localStorage.getItem(TOKEN_KEY); }   catch { return null; } }
function getRefreshToken() { try { return localStorage.getItem(REFRESH_KEY); } catch { return null; } }
function authHeader() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Exchange the stored refresh token for a new access+refresh pair. */
export async function refreshAccessToken() {
  const refresh_token = getRefreshToken();
  if (!refresh_token) return false;
  try {
    const res = await fetch(`${BASE}/api/users/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) { clearAuthToken(); return false; }
    const body = await res.json();
    setAuthSession(body);
    return true;
  } catch { return false; }
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

export async function submitReport(report) {
  return request('/api/reports', { method: 'POST', body: JSON.stringify(report) });
}

export async function searchByName(q) {
  return request(`/api/reports/search?q=${encodeURIComponent(q)}`);
}

export async function getRescueView(lat, lng, radius, token) {
  return request(
    `/api/reports/rescue?lat=${lat}&lng=${lng}&radius=${radius}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

export async function getStats({ excludeWeb = false } = {}) {
  return request(`/api/reports/stats${excludeWeb ? '?exclude_web=true' : ''}`);
}

export async function getDisasters() {
  return request('/api/disasters');
}

export async function triggerDisaster(payload, token) {
  return request('/api/disasters/trigger', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
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
  return request(`/api/shelters${qs ? `?${qs}` : ''}`);
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
  return request(`/api/safe-places${qs ? `?${qs}` : ''}`);
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
  return request('/api/safe-places/pending', {
    headers: { Authorization: `Bearer ${token}` },
  });
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
  return request(`/api/users/${encodeURIComponent(phone)}/profile`, { headers: authHeader() });
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
  return request(`/api/users/${uid}/links`, { headers: authHeader() });
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

export async function adminGetStats()     { return adminRequest('/api/admin/stats'); }
export async function adminGetAudit(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return adminRequest(`/api/admin/audit${qs ? `?${qs}` : ''}`);
}

// Users
export async function adminListUsers(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return adminRequest(`/api/admin/users${qs ? `?${qs}` : ''}`);
}
export async function adminCreateUser(data)     { return adminRequest('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }); }
export async function adminUpdateUser(id, data) { return adminRequest(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function adminDeleteUser(id)       { return adminRequest(`/api/admin/users/${id}`, { method: 'DELETE' }); }

// Reports
export async function adminListReports(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return adminRequest(`/api/admin/reports${qs ? `?${qs}` : ''}`);
}
export async function adminCreateReport(data)     { return adminRequest('/api/admin/reports', { method: 'POST', body: JSON.stringify(data) }); }
export async function adminUpdateReport(id, data) { return adminRequest(`/api/admin/reports/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function adminDeleteReport(id)       { return adminRequest(`/api/admin/reports/${id}`, { method: 'DELETE' }); }

// Disasters
export async function adminListDisasters(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return adminRequest(`/api/admin/disasters${qs ? `?${qs}` : ''}`);
}
export async function adminCreateDisaster(data)         { return adminRequest('/api/admin/disasters', { method: 'POST', body: JSON.stringify(data) }); }
export async function adminUpdateDisaster(id, data)     { return adminRequest(`/api/admin/disasters/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function adminDeleteDisaster(id)           { return adminRequest(`/api/admin/disasters/${id}`, { method: 'DELETE' }); }

// Links
export async function adminListLinks(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return adminRequest(`/api/admin/links${qs ? `?${qs}` : ''}`);
}
export async function adminUpdateLink(id, data) { return adminRequest(`/api/admin/links/${id}`, { method: 'PUT', body: JSON.stringify(data) }); }
export async function adminDeleteLink(id)       { return adminRequest(`/api/admin/links/${id}`, { method: 'DELETE' }); }

// Devices
export async function adminListDevices(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return adminRequest(`/api/admin/devices${qs ? `?${qs}` : ''}`);
}
export async function adminDeleteDevice(id) { return adminRequest(`/api/admin/devices/${id}`, { method: 'DELETE' }); }
