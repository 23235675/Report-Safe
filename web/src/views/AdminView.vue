<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  adminLogin, adminGetStats, adminGetAudit,
  adminListUsers, adminCreateUser, adminUpdateUser, adminDeleteUser,
  adminListReports, adminCreateReport, adminUpdateReport, adminDeleteReport,
  adminListDisasters, adminCreateDisaster, adminUpdateDisaster, adminDeleteDisaster,
  adminListLinks, adminUpdateLink, adminDeleteLink,
  adminListDevices, adminDeleteDevice,
  getAdminToken, getAdminUser, setAdminSession, clearAdminSession,
} from '../api.js';

const adminToken = ref(getAdminToken() || '');
const adminUser  = ref(getAdminUser());
const loginPhone = ref('');
const loginPass  = ref('');
const loginError = ref(null);
const loginBusy  = ref(false);

async function login() {
  loginError.value = null;
  loginBusy.value  = true;
  try {
    const res = await adminLogin(loginPhone.value.trim(), loginPass.value);
    setAdminSession(res);
    adminToken.value = res.access_token;
    adminUser.value  = res.user;
    loginPass.value  = '';
    await switchTab('overview');
  } catch (e) {
    loginError.value = e.message || 'Login failed';
  } finally {
    loginBusy.value = false;
  }
}

function logout() {
  clearAdminSession();
  adminToken.value = '';
  adminUser.value  = null;
  rows.value       = {};
  stats.value      = null;
}

const TABS = [
  { id: 'overview',   label: 'Overview' },
  { id: 'users',      label: 'Users' },
  { id: 'reports',    label: 'Reports' },
  { id: 'disasters',  label: 'Disasters' },
  { id: 'links',      label: 'Links' },
  { id: 'devices',    label: 'Devices' },
  { id: 'audit',      label: 'Audit Log' },
];

const activeTab   = ref('overview');
const loading     = ref(false);
const error       = ref(null);
const rows        = ref({});
const totals      = ref({});
const stats       = ref(null);
const searchQ     = ref('');
const offset      = ref(0);
const PAGE        = 100;

const FILTER_DEFAULTS = {
  overview:  {},
  users:     { role: '', user_type: '', consent: '', has_email: '' },
  reports:   { status: '', reported_by: '', user_type: '', disaster_id: '' },
  disasters: { active: '', type: '' },
  devices:   { platform: '', located: '', linked: '' },
  links:     { status: '' },
  audit:     { action: '', entity: '' },
};
function freshFilters() { return JSON.parse(JSON.stringify(FILTER_DEFAULTS)); }
const filters = ref(freshFilters());

const REPORT_STATUSES = ['need_help', 'injured', 'missing', 'verified_missing',
  'potentially_missing', 'awaiting_response', 'rescued', 'deceased', 'safe'];
const DISASTER_TYPES  = ['typhoon', 'flood', 'earthquake', 'landslide', 'fire', 'tsunami', 'other'];
const disasterOptions = ref([]);

function filterParams(tab) {
  const f = filters.value[tab] || {};
  const p = {};
  for (const [k, v] of Object.entries(f)) if (v !== '') p[k] = v;
  return p;
}
function hasFilters(tab) { return Object.values(filters.value[tab] || {}).some((v) => v !== ''); }
function applyFilters(tab) { offset.value = 0; loadTab(tab, searchQ.value, 0); }
function clearFilters(tab) { filters.value[tab] = { ...(FILTER_DEFAULTS[tab] || {}) }; applyFilters(tab); }

async function ensureDisasterOptions() {
  if (disasterOptions.value.length) return;
  try { const res = await adminListDisasters(); disasterOptions.value = res.rows || []; } catch {}
}

async function switchTab(tab) {
  activeTab.value = tab;
  error.value     = null;
  searchQ.value   = '';
  offset.value    = 0;
  filters.value[tab] = { ...(FILTER_DEFAULTS[tab] || {}) };
  if (tab === 'reports') ensureDisasterOptions();
  await loadTab(tab);
}

async function loadTab(tab, q = '', off = 0) {
  loading.value = true;
  error.value   = null;
  try {
    if (tab === 'overview') {
      stats.value = await adminGetStats();
    } else if (tab === 'users') {
      const res = await adminListUsers({ q, limit: PAGE, offset: off, ...filterParams('users') });
      rows.value   = { ...rows.value, users: res.rows };
      totals.value = { ...totals.value, users: res.total };
    } else if (tab === 'reports') {
      const res = await adminListReports({ q, limit: PAGE, offset: off, ...filterParams('reports') });
      rows.value   = { ...rows.value, reports: res.rows };
      totals.value = { ...totals.value, reports: res.total };
    } else if (tab === 'disasters') {
      const res = await adminListDisasters(filterParams('disasters'));
      rows.value   = { ...rows.value, disasters: res.rows };
    } else if (tab === 'links') {
      const res = await adminListLinks({ q, limit: PAGE, offset: off, ...filterParams('links') });
      rows.value   = { ...rows.value, links: res.rows };
      totals.value = { ...totals.value, links: res.total };
    } else if (tab === 'devices') {
      const res = await adminListDevices({ limit: PAGE, offset: off, ...filterParams('devices') });
      rows.value   = { ...rows.value, devices: res.rows };
      totals.value = { ...totals.value, devices: res.total };
    } else if (tab === 'audit') {
      const res = await adminGetAudit(filterParams('audit'));
      rows.value   = { ...rows.value, audit: res.rows };
    }
  } catch (e) {
    error.value = e.message || 'Failed to load data';
  } finally {
    loading.value = false;
  }
}

async function doSearch() { offset.value = 0; await loadTab(activeTab.value, searchQ.value, 0); }
async function prevPage() { if (offset.value <= 0) return; offset.value = Math.max(0, offset.value - PAGE); await loadTab(activeTab.value, searchQ.value, offset.value); }
async function nextPage() { const t = totals.value[activeTab.value] ?? 0; if (offset.value + PAGE >= t) return; offset.value += PAGE; await loadTab(activeTab.value, searchQ.value, offset.value); }

const showForm  = ref(false);
const formMode  = ref('create');
const editId    = ref(null);
const formData  = ref({});
const formBusy  = ref(false);
const formError = ref(null);

const FORM_FIELDS = {
  users: [
    { key: 'phone', label: 'Phone', required: true },
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'personal_id', label: 'HKID', required: false },
    { key: 'role', label: 'Role', required: false, type: 'select', options: ['citizen','volunteer','government','super_admin'] },
    { key: 'user_type', label: 'User Type', required: false, type: 'select', options: ['mobile','web'] },
    { key: 'password', label: 'Password', required: false, type: 'password', note: 'Required for super_admin' },
    { key: 'privacy_consent', label: 'Privacy Consent', required: false, type: 'checkbox' },
  ],
  reports: [
    { key: 'name', label: 'Name', required: true },
    { key: 'status', label: 'Status', required: true, type: 'select', options: ['safe','injured','need_help','awaiting_response','potentially_missing','missing','verified_missing','rescued','deceased'] },
    { key: 'lat', label: 'Latitude', required: true, type: 'number' },
    { key: 'lng', label: 'Longitude', required: true, type: 'number' },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'personal_id', label: 'HKID', required: false },
    { key: 'medical_notes', label: 'Medical Notes', required: false, type: 'textarea' },
    { key: 'disaster_id', label: 'Disaster ID', required: false },
  ],
  disasters: [
    { key: 'type', label: 'Type', required: true, type: 'select', options: ['typhoon','flood','earthquake','landslide','fire','tsunami','other'] },
    { key: 'severity', label: 'Severity 1–5', required: false, type: 'number' },
    { key: 'magnitude', label: 'Magnitude', required: false, type: 'number' },
    { key: 'lat', label: 'Latitude', required: true, type: 'number' },
    { key: 'lng', label: 'Longitude', required: true, type: 'number' },
    { key: 'radius_km', label: 'Radius (km)', required: true, type: 'number' },
    { key: 'description', label: 'Description', required: false, type: 'textarea' },
    { key: 'active', label: 'Active', required: false, type: 'checkbox' },
  ],
};

function openCreate(tab) { formMode.value = 'create'; editId.value = null; formData.value = tab === 'disasters' ? { active: true } : {}; formError.value = null; showForm.value = true; }
function openEdit(tab, row) { formMode.value = 'edit'; editId.value = row.id; formData.value = { ...row }; formError.value = null; showForm.value = true; }
function closeForm() { showForm.value = false; formData.value = {}; formError.value = null; }

async function submitForm() {
  formBusy.value = true; formError.value = null;
  const tab = activeTab.value;
  try {
    if (tab === 'users') { if (formMode.value === 'create') await adminCreateUser(formData.value); else await adminUpdateUser(editId.value, formData.value); }
    else if (tab === 'reports') { if (formMode.value === 'create') await adminCreateReport(formData.value); else await adminUpdateReport(editId.value, formData.value); }
    else if (tab === 'disasters') { if (formMode.value === 'create') await adminCreateDisaster(formData.value); else await adminUpdateDisaster(editId.value, formData.value); }
    closeForm(); await loadTab(tab, searchQ.value, offset.value);
  } catch (e) { formError.value = e.message || 'Save failed'; }
  finally { formBusy.value = false; }
}

const deleteTarget = ref(null);
const deleteBusy   = ref(false);
function confirmDelete(tab, row) { deleteTarget.value = { tab, row }; }
async function doDelete() {
  if (!deleteTarget.value) return;
  deleteBusy.value = true;
  const { tab, row } = deleteTarget.value;
  try {
    if (tab === 'users') await adminDeleteUser(row.id);
    else if (tab === 'reports') await adminDeleteReport(row.id);
    else if (tab === 'disasters') await adminDeleteDisaster(row.id);
    else if (tab === 'links') await adminDeleteLink(row.id);
    else if (tab === 'devices') await adminDeleteDevice(row.id);
    deleteTarget.value = null; await loadTab(tab, searchQ.value, offset.value);
  } catch (e) { error.value = e.message || 'Delete failed'; deleteTarget.value = null; }
  finally { deleteBusy.value = false; }
}

async function setLinkStatus(row, status) {
  try { await adminUpdateLink(row.id, { status }); await loadTab('links', searchQ.value, offset.value); }
  catch (e) { error.value = e.message; }
}

function fmt(ts) { if (!ts) return '—'; return new Date(Number(ts)).toLocaleString('en-HK', { dateStyle: 'short', timeStyle: 'short' }); }
function shortId(id) { return id ? id.split('-')[0] : '—'; }
const currentRows = computed(() => rows.value[activeTab.value] ?? []);
const canPage     = computed(() => ['users','reports','links','devices'].includes(activeTab.value));
const total       = computed(() => totals.value[activeTab.value] ?? currentRows.value.length);

const nowStr = ref('');
let clockTimer = null;
function tickClock() {
  const d = new Date();
  nowStr.value = d.toLocaleString('en-HK', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

onMounted(() => {
  tickClock(); clockTimer = setInterval(tickClock, 1000);
  if (!adminToken.value && location.hostname === 'localhost') {
    adminToken.value = 'dev-bypass';
    adminUser.value = { name: 'Admin (Dev)', phone: 'localhost' };
    switchTab('overview');
  }
});
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer); });
</script>

<template>
  <!-- LOGIN -->
  <div v-if="!adminToken" class="login-wrap">
    <div class="login-card">
      <div class="login-hd">
        <div class="login-crest">報</div>
        <div class="login-titles">
          <h1>Report Safe</h1>
          <p>Administration Console</p>
        </div>
      </div>
      <form @submit.prevent="login" class="login-form">
        <label>Phone</label>
        <input v-model="loginPhone" class="inp" type="tel" placeholder="+852 9xxx xxxx" autocomplete="username" required />
        <label>Password</label>
        <input v-model="loginPass" class="inp" type="password" placeholder="••••••••" autocomplete="current-password" required />
        <div v-if="loginError" class="form-err">{{ loginError }}</div>
        <button class="btn btn-dark" type="submit" :disabled="loginBusy">{{ loginBusy ? 'Signing in…' : 'Sign in' }}</button>
      </form>
    </div>
  </div>

  <!-- DASHBOARD -->
  <div v-else class="shell">
    <header class="topbar">
      <div class="topbar-l">
        <span class="topbar-crest">報</span>
        <span class="topbar-name">Report Safe</span>
        <span class="topbar-div">/</span>
        <span class="topbar-sub">Admin Console</span>
      </div>
      <div class="topbar-r">
        <span class="topbar-ts">{{ nowStr }}</span>
        <span class="topbar-user">{{ adminUser?.name || adminUser?.phone }}</span>
        <button class="topbar-logout" @click="logout">Sign out</button>
      </div>
    </header>

    <div class="body">
      <nav class="sidebar">
        <button v-for="tab in TABS" :key="tab.id" class="nav-btn" :class="{ on: activeTab === tab.id }" @click="switchTab(tab.id)">{{ tab.label }}</button>
      </nav>

      <main class="content">
        <div v-if="error" class="err-bar">{{ error }} <button @click="error = null">✕</button></div>

        <!-- OVERVIEW -->
        <section v-if="activeTab === 'overview'">
          <h2 class="page-title">System Overview</h2>
          <div v-if="loading" class="state-msg">Loading…</div>
          <div v-else-if="!stats" class="state-msg">No data available.</div>
          <div v-else class="stat-grid">
            <div class="stat-card" v-for="(val, key) in stats" :key="key">
              <div class="stat-label">{{ key.replace(/_/g, ' ') }}</div>
              <div class="stat-val" v-if="typeof val === 'object'">
                <div v-for="(v2, k2) in val" :key="k2" class="stat-sub">
                  <span>{{ k2.replace(/_/g, ' ') }}</span>
                  <span class="stat-num">{{ v2 }}</span>
                </div>
              </div>
              <div class="stat-val stat-num" v-else>{{ val }}</div>
            </div>
          </div>
        </section>

        <!-- USERS -->
        <section v-if="activeTab === 'users'">
          <div class="toolbar"><h2 class="page-title">Users</h2>
            <div class="toolbar-r">
              <form @submit.prevent="doSearch" class="search-bar"><input v-model="searchQ" class="inp" placeholder="Search name / phone…" /><button class="btn" type="submit">Search</button></form>
              <button class="btn btn-dark" @click="openCreate('users')">+ New</button>
            </div></div>
          <div class="filter-row">
            <select v-model="filters.users.role" class="flt" @change="applyFilters('users')"><option value="">Role: all</option><option value="citizen">citizen</option><option value="volunteer">volunteer</option><option value="government">government</option><option value="super_admin">super_admin</option></select>
            <select v-model="filters.users.user_type" class="flt" @change="applyFilters('users')"><option value="">Type: all</option><option value="mobile">mobile</option><option value="web">web</option></select>
            <select v-model="filters.users.consent" class="flt" @change="applyFilters('users')"><option value="">Consent: any</option><option value="true">given</option><option value="false">none</option></select>
            <select v-model="filters.users.has_email" class="flt" @change="applyFilters('users')"><option value="">Email: any</option><option value="true">has</option><option value="false">none</option></select>
            <button v-if="hasFilters('users')" class="flt-clear" @click="clearFilters('users')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <div v-else class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Phone</th><th>Name</th><th>Email</th><th>HKID</th><th>Role</th><th>Type</th><th>Consent</th><th>Created</th><th></th></tr></thead>
            <tbody><tr v-for="u in currentRows" :key="u.id"><td class="mono" :title="u.id">{{ shortId(u.id) }}</td><td>{{ u.phone }}</td><td>{{ u.name || '—' }}</td><td>{{ u.email || '—' }}</td><td class="mono">{{ u.personal_id || '—' }}</td><td>{{ u.role }}</td><td>{{ u.user_type }}</td><td>{{ u.privacy_consent ? 'Y' : 'N' }}</td><td class="ts">{{ fmt(u.created_at) }}</td><td class="acts"><button class="btn btn-xs" @click="openEdit('users', u)">Edit</button><button class="btn btn-xs" @click="confirmDelete('users', u)">Del</button></td></tr></tbody></table></div>
        </section>

        <!-- REPORTS -->
        <section v-if="activeTab === 'reports'">
          <div class="toolbar"><h2 class="page-title">Status Reports</h2>
            <div class="toolbar-r">
              <form @submit.prevent="doSearch" class="search-bar"><input v-model="searchQ" class="inp" placeholder="Search name / phone…" /><button class="btn" type="submit">Search</button></form>
              <button class="btn btn-dark" @click="openCreate('reports')">+ New</button>
            </div></div>
          <div class="filter-row">
            <select v-model="filters.reports.status" class="flt" @change="applyFilters('reports')"><option value="">Status: all</option><option v-for="s in REPORT_STATUSES" :key="s" :value="s">{{ s.replace(/_/g, ' ') }}</option></select>
            <select v-model="filters.reports.reported_by" class="flt" @change="applyFilters('reports')"><option value="">Source: all</option><option value="self">self</option><option value="family">family</option></select>
            <select v-model="filters.reports.user_type" class="flt" @change="applyFilters('reports')"><option value="">Origin: all</option><option value="mobile">mobile</option><option value="web">web</option></select>
            <select v-model="filters.reports.disaster_id" class="flt" @change="applyFilters('reports')"><option value="">Disaster: all</option><option value="__any__">in zone</option><option value="__none__">no zone</option><option v-for="d in disasterOptions" :key="d.id" :value="d.id">{{ d.type }} — {{ shortId(d.id) }}</option></select>
            <button v-if="hasFilters('reports')" class="flt-clear" @click="clearFilters('reports')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <div v-else class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Lat</th><th>Lng</th><th>Phone</th><th>HKID</th><th>Medical</th><th>Linked User</th><th>Relays</th><th>Updated</th><th></th></tr></thead>
            <tbody><tr v-for="r in currentRows" :key="r.id"><td class="mono" :title="r.id">{{ shortId(r.id) }}</td><td>{{ r.user_name || r.name }}<span v-if="r.user_name && r.name && r.user_name !== r.name" class="sub"> ({{ r.name }})</span></td><td><span class="badge">{{ r.status }}</span></td><td class="mono">{{ Number(r.lat).toFixed(4) }}</td><td class="mono">{{ Number(r.lng).toFixed(4) }}</td><td>{{ r.phone || '—' }}</td><td class="mono">{{ r.personal_id || '—' }}</td><td class="clip">{{ r.medical_notes || '—' }}</td><td>{{ r.user_name || '—' }}<br v-if="r.user_name" /><span class="sub">{{ r.user_phone || '' }}</span></td><td>{{ r.relay_count }}</td><td class="ts">{{ fmt(r.updated_at) }}</td><td class="acts"><button class="btn btn-xs" @click="openEdit('reports', r)">Edit</button><button class="btn btn-xs" @click="confirmDelete('reports', r)">Del</button></td></tr></tbody></table></div>
        </section>

        <!-- DISASTERS -->
        <section v-if="activeTab === 'disasters'">
          <div class="toolbar"><h2 class="page-title">Disasters</h2>
            <div class="toolbar-r"><button class="btn btn-dark" @click="openCreate('disasters')">+ New</button></div></div>
          <div class="filter-row">
            <select v-model="filters.disasters.active" class="flt" @change="applyFilters('disasters')"><option value="">Status: all</option><option value="true">active</option><option value="false">ended</option></select>
            <select v-model="filters.disasters.type" class="flt" @change="applyFilters('disasters')"><option value="">Type: all</option><option v-for="t in DISASTER_TYPES" :key="t" :value="t">{{ t }}</option></select>
            <button v-if="hasFilters('disasters')" class="flt-clear" @click="clearFilters('disasters')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <div v-else class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Type</th><th>Severity</th><th>Magnitude</th><th>Lat</th><th>Lng</th><th>Radius</th><th>Description</th><th>Active</th><th>Started</th><th></th></tr></thead>
            <tbody><tr v-for="d in currentRows" :key="d.id"><td class="mono" :title="d.id">{{ shortId(d.id) }}</td><td>{{ d.type }}</td><td>{{ d.severity ?? '—' }}</td><td>{{ d.magnitude ?? '—' }}</td><td class="mono">{{ Number(d.lat).toFixed(4) }}</td><td class="mono">{{ Number(d.lng).toFixed(4) }}</td><td>{{ d.radius_km }}km</td><td class="clip">{{ d.description || '—' }}</td><td>{{ d.active ? 'Y' : 'N' }}</td><td class="ts">{{ fmt(d.started_at) }}</td><td class="acts"><button class="btn btn-xs" @click="openEdit('disasters', d)">Edit</button><button class="btn btn-xs" @click="confirmDelete('disasters', d)">Del</button></td></tr></tbody></table></div>
        </section>

        <!-- LINKS -->
        <section v-if="activeTab === 'links'">
          <div class="toolbar"><h2 class="page-title">Account Links</h2>
            <div class="toolbar-r"><form @submit.prevent="doSearch" class="search-bar"><input v-model="searchQ" class="inp" placeholder="Search name / phone…" /><button class="btn" type="submit">Search</button></form></div></div>
          <div class="filter-row">
            <select v-model="filters.links.status" class="flt" @change="applyFilters('links')"><option value="">Status: all</option><option value="confirmed">confirmed</option><option value="pending">pending</option><option value="blocked">blocked</option></select>
            <button v-if="hasFilters('links')" class="flt-clear" @click="clearFilters('links')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <div v-else class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>User A</th><th>Phone A</th><th>User B</th><th>Phone B</th><th>Status</th><th>Confirmed</th><th>Created</th><th></th></tr></thead>
            <tbody><tr v-for="l in currentRows" :key="l.id"><td class="mono" :title="l.id">{{ shortId(l.id) }}</td><td>{{ l.user_a_name || '—' }}</td><td>{{ l.user_a_phone }}</td><td>{{ l.user_b_name || '—' }}</td><td>{{ l.user_b_phone }}</td><td><select class="flt inline" :value="l.status" @change="setLinkStatus(l, $event.target.value)"><option value="pending">pending</option><option value="confirmed">confirmed</option><option value="blocked">blocked</option></select></td><td class="ts">{{ fmt(l.confirmed_at) }}</td><td class="ts">{{ fmt(l.created_at) }}</td><td class="acts"><button class="btn btn-xs" @click="confirmDelete('links', l)">Del</button></td></tr></tbody></table></div>
        </section>

        <!-- DEVICES -->
        <section v-if="activeTab === 'devices'">
          <div class="toolbar"><h2 class="page-title">Device Push Tokens</h2></div>
          <div class="filter-row">
            <select v-model="filters.devices.platform" class="flt" @change="applyFilters('devices')"><option value="">Platform: all</option><option value="ios">iOS</option><option value="android">Android</option></select>
            <select v-model="filters.devices.located" class="flt" @change="applyFilters('devices')"><option value="">GPS: any</option><option value="true">has</option><option value="false">none</option></select>
            <select v-model="filters.devices.linked" class="flt" @change="applyFilters('devices')"><option value="">Account: any</option><option value="true">linked</option><option value="false">unlinked</option></select>
            <button v-if="hasFilters('devices')" class="flt-clear" @click="clearFilters('devices')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <div v-else class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>User</th><th>Phone</th><th>Platform</th><th>Token</th><th>Lat</th><th>Lng</th><th>Updated</th><th></th></tr></thead>
            <tbody><tr v-for="d in currentRows" :key="d.id"><td class="mono" :title="d.id">{{ shortId(d.id) }}</td><td>{{ d.user_name || '—' }}</td><td>{{ d.user_phone || '—' }}</td><td>{{ d.platform }}</td><td class="mono clip">{{ d.token?.slice(0, 20) }}…</td><td>{{ d.lat != null ? Number(d.lat).toFixed(4) : '—' }}</td><td>{{ d.lng != null ? Number(d.lng).toFixed(4) : '—' }}</td><td class="ts">{{ fmt(d.updated_at) }}</td><td class="acts"><button class="btn btn-xs" @click="confirmDelete('devices', d)">Del</button></td></tr></tbody></table></div>
        </section>

        <!-- AUDIT -->
        <section v-if="activeTab === 'audit'">
          <div class="toolbar"><h2 class="page-title">Audit Log</h2><button class="btn" @click="loadTab('audit', '', 0)">Refresh</button></div>
          <div class="filter-row">
            <select v-model="filters.audit.action" class="flt" @change="applyFilters('audit')"><option value="">Action: all</option><option value="create">create</option><option value="update">update</option><option value="delete">delete</option><option value="login">login</option></select>
            <select v-model="filters.audit.entity" class="flt" @change="applyFilters('audit')"><option value="">Entity: all</option><option value="users">users</option><option value="reports">reports</option><option value="disasters">disasters</option><option value="account_links">links</option><option value="device_push_tokens">devices</option></select>
            <button v-if="hasFilters('audit')" class="flt-clear" @click="clearFilters('audit')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <div v-else class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Actor</th><th>Details</th></tr></thead>
            <tbody><tr v-for="a in currentRows" :key="a.id"><td class="ts">{{ fmt(a.created_at) }}</td><td>{{ a.action }}</td><td>{{ a.entity }}</td><td class="mono" :title="a.entity_id">{{ shortId(a.entity_id) }}</td><td>{{ a.actor }}</td><td class="clip sub">{{ a.details || '—' }}</td></tr></tbody></table></div>
        </section>

        <div v-if="canPage && !loading" class="pager">
          <span class="pager-info">{{ offset + 1 }}–{{ Math.min(offset + PAGE, total) }} of {{ total }}</span>
          <button class="btn" :disabled="offset <= 0" @click="prevPage">Prev</button>
          <button class="btn" :disabled="offset + PAGE >= total" @click="nextPage">Next</button>
        </div>
      </main>
    </div>

    <!-- FORM MODAL -->
    <div v-if="showForm" class="overlay" @click.self="closeForm">
      <div class="modal">
        <div class="modal-hd"><h3>{{ formMode === 'create' ? 'New' : 'Edit' }} {{ activeTab.replace(/s$/, '') }}</h3><button class="modal-x" @click="closeForm">✕</button></div>
        <form @submit.prevent="submitForm" class="modal-body">
          <template v-for="field in FORM_FIELDS[activeTab] || []" :key="field.key">
            <label>{{ field.label }} <span v-if="field.required" class="req">*</span><span v-if="field.note" class="sub"> — {{ field.note }}</span></label>
            <textarea v-if="field.type === 'textarea'" v-model="formData[field.key]" class="inp" rows="3" />
            <select v-else-if="field.type === 'select'" v-model="formData[field.key]" class="inp"><option value="">—</option><option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option></select>
            <label v-else-if="field.type === 'checkbox'" class="chk"><input type="checkbox" v-model="formData[field.key]" /> {{ field.label }}</label>
            <input v-else v-model="formData[field.key]" class="inp" :type="field.type || 'text'" :required="field.required && formMode === 'create'" />
          </template>
          <div v-if="formError" class="form-err">{{ formError }}</div>
          <div class="modal-acts">
            <button type="button" class="btn" @click="closeForm">Cancel</button>
            <button type="submit" class="btn btn-dark" :disabled="formBusy">{{ formBusy ? 'Saving…' : (formMode === 'create' ? 'Create' : 'Save') }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- DELETE CONFIRM -->
    <div v-if="deleteTarget" class="overlay" @click.self="deleteTarget = null">
      <div class="modal modal-sm">
        <div class="modal-hd"><h3>Confirm deletion</h3><button class="modal-x" @click="deleteTarget = null">✕</button></div>
        <p class="modal-msg">Permanently delete this <strong>{{ deleteTarget.tab.replace(/s$/, '') }}</strong> record?</p>
        <div class="modal-acts" style="padding:0 20px 16px;">
          <button class="btn" @click="deleteTarget = null">Cancel</button>
          <button class="btn btn-dark" :disabled="deleteBusy" @click="doDelete">{{ deleteBusy ? 'Deleting…' : 'Delete' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing:border-box; transition:none !important; }

/* ── Login ─────────────────────────────────────────────── */
.login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f0f0f0; }
.login-card { width:360px; background:#fff; border:1px solid #d0d0d0; padding:32px 28px; }
.login-hd { display:flex; align-items:center; gap:12px; margin-bottom:24px; border-bottom:1px solid #d0d0d0; padding-bottom:16px; }
.login-crest { width:40px; height:40px; background:#e0e0e0; border:1px solid #c0c0c0; display:flex; align-items:center; justify-content:center; color:#333; font-size:20px; font-weight:700; }
.login-titles h1 { font-size:15px; font-weight:700; color:#222; margin:0; }
.login-titles p { font-size:11px; color:#888; margin:2px 0 0; }
.login-form { display:flex; flex-direction:column; gap:6px; }
.login-form label { font-size:11px; font-weight:600; color:#555; margin-top:6px; }

/* ── Shell ──────────────────────────────────────────────── */
.shell { display:flex; flex-direction:column; height:100vh; background:#fff; font-family:var(--font-ui); font-size:13px; color:#222; overflow:hidden; }
.body { display:flex; flex:1; min-height:0; }

/* ── Top Bar ───────────────────────────────────────────── */
.topbar { display:flex; align-items:center; justify-content:space-between; height:36px; padding:0 14px; background:#e8e8e8; color:#555; border-bottom:1px solid #d0d0d0; flex-shrink:0; }
.topbar-l { display:flex; align-items:center; gap:8px; }
.topbar-crest { width:22px; height:22px; background:#d0d0d0; border:1px solid #bbb; display:flex; align-items:center; justify-content:center; font-size:12px; color:#333; }
.topbar-name { font-size:13px; font-weight:700; color:#222; }
.topbar-div { color:#ccc; }
.topbar-sub { font-size:11px; color:#888; font-weight:500; }
.topbar-r { display:flex; align-items:center; gap:12px; }
.topbar-ts { font-size:11px; color:#888; font-family:var(--font-mono); }
.topbar-user { font-size:11px; color:#666; }
.topbar-logout { padding:3px 10px; background:transparent; border:1px solid #ccc; color:#555; font-size:11px; cursor:pointer; font-family:inherit; }
.topbar-logout:hover { border-color:#999; color:#222; }

/* ── Sidebar ───────────────────────────────────────────── */
.sidebar { width:140px; background:#f0f0f0; border-right:1px solid #d0d0d0; display:flex; flex-direction:column; padding:6px 0; gap:0; flex-shrink:0; overflow-y:auto; }
.nav-btn { display:block; padding:7px 12px; background:transparent; border:none; border-left:2px solid transparent; color:#555; cursor:pointer; text-align:left; font-size:12px; font-weight:500; font-family:inherit; width:100%; }
.nav-btn:hover { color:#222; background:#e0e0e0; }
.nav-btn.on { color:#222; font-weight:700; border-left-color:#888; background:#e0e0e0; }

/* ── Content ───────────────────────────────────────────── */
.content { flex:1; overflow:auto; padding:16px 20px; display:flex; flex-direction:column; gap:12px; background:#fff; }

/* ── Typography ────────────────────────────────────────── */
.page-title { font-size:14px; font-weight:700; color:#222; margin:0; }
.toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.toolbar-r { display:flex; align-items:center; gap:8px; }
.search-bar { display:flex; gap:4px; }
.search-bar .inp { width:180px; }

/* ── Filters ───────────────────────────────────────────── */
.filter-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.flt { padding:4px 8px; border:1px solid #d0d0d0; background:#fff; font-size:11px; color:#333; font-family:inherit; cursor:pointer; border-radius:2px; }
.flt:focus { outline:none; border-color:#999; }
.flt.inline { border-color:#d0d0d0; }
.flt-clear { padding:4px 8px; font-size:11px; background:transparent; border:none; color:#888; cursor:pointer; text-decoration:underline; font-family:inherit; }

/* ── Inputs ────────────────────────────────────────────── */
.inp { padding:6px 8px; border:1px solid #d0d0d0; font-size:13px; color:#222; background:#fff; width:100%; font-family:inherit; border-radius:2px; }
.inp:focus { outline:none; border-color:#999; }

/* ── Buttons ───────────────────────────────────────────── */
.btn { padding:5px 12px; border:1px solid #d0d0d0; background:#f5f5f5; color:#333; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; border-radius:2px; }
.btn:hover:not(:disabled) { background:#e8e8e8; }
.btn:disabled { opacity:.35; cursor:not-allowed; }
.btn-dark { background:#555; color:#fff; border-color:#555; }
.btn-dark:hover:not(:disabled) { background:#444; }
.btn-xs { padding:2px 6px; font-size:10px; }

/* ── Tables ────────────────────────────────────────────── */
.tbl-wrap { overflow:auto; border:1px solid #d0d0d0; background:#fff; }
.tbl { width:100%; border-collapse:collapse; font-size:12px; }
.tbl th { background:#e8e8e8; color:#333; font-weight:600; font-size:11px; padding:7px 8px; border-bottom:1px solid #d0d0d0; text-align:left; white-space:nowrap; }
.tbl td { padding:6px 8px; border-bottom:1px solid #eee; vertical-align:middle; color:#222; }
.tbl tr:last-child td { border-bottom:none; }
.tbl tr:hover td { background:#f9f9f9; }
.mono { font-family:var(--font-mono); color:#555; }
.sub { color:#888; font-size:11px; }
.ts { font-size:11px; color:#888; white-space:nowrap; font-family:var(--font-mono); }
.clip { max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acts { white-space:nowrap; }
.badge { font-size:11px; color:#555; font-weight:500; }

/* ── Stats Grid ────────────────────────────────────────── */
.stat-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:8px; }
.stat-card { border:1px solid #d0d0d0; background:#fff; padding:10px 12px; border-radius:2px; }
.stat-label { font-size:11px; font-weight:700; color:#555; margin-bottom:6px; border-bottom:1px solid #eee; padding-bottom:4px; }
.stat-sub { display:flex; justify-content:space-between; font-size:12px; color:#666; padding:2px 0; }
.stat-num { font-weight:700; color:#222; font-family:var(--font-mono); }

/* ── Pagination ────────────────────────────────────────── */
.pager { display:flex; align-items:center; gap:8px; }
.pager-info { font-size:11px; color:#888; margin-right:auto; }

/* ── States ────────────────────────────────────────────── */
.err-bar { display:flex; align-items:center; gap:8px; padding:6px 10px; background:#fff; border:1px solid #d0d0d0; color:#222; font-size:12px; }
.err-bar button { margin-left:auto; background:none; border:none; cursor:pointer; color:#888; font-size:14px; }
.form-err { padding:6px 8px; background:#fff; border:1px solid #d0d0d0; font-size:12px; color:#222; }
.state-msg { color:#888; padding:16px 0; font-size:12px; }

/* ── Modal ──────────────────────────────────────────────── */
.overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; z-index:1000; }
.modal { background:#fff; width:440px; max-width:96vw; max-height:90vh; overflow-y:auto; border:1px solid #d0d0d0; border-radius:2px; }
.modal-sm { width:340px; }
.modal-hd { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #e0e0e0; background:#f5f5f5; }
.modal-hd h3 { margin:0; font-size:13px; font-weight:700; color:#222; }
.modal-x { background:none; border:none; font-size:16px; cursor:pointer; color:#888; }
.modal-body { display:flex; flex-direction:column; gap:5px; padding:14px 16px; }
.modal-body label { font-size:11px; font-weight:600; color:#555; margin-top:4px; }
.modal-acts { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; padding-top:10px; border-top:1px solid #eee; }
.modal-msg { padding:12px 16px; color:#555; line-height:1.5; margin:0; font-size:13px; }
.req { color:#888; }
.chk { display:flex; align-items:center; gap:6px; font-size:12px; color:#222; cursor:pointer; text-transform:none; }
</style>
