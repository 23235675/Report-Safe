<script setup>
import { ref, computed } from 'vue';
import {
  adminLogin, adminGetStats, adminGetAudit,
  adminListUsers, adminCreateUser, adminUpdateUser, adminDeleteUser,
  adminListReports, adminCreateReport, adminUpdateReport, adminDeleteReport,
  adminListDisasters, adminCreateDisaster, adminUpdateDisaster, adminDeleteDisaster,
  adminListLinks, adminUpdateLink, adminDeleteLink,
  adminListDevices, adminDeleteDevice,
  getAdminToken, getAdminUser, setAdminSession, clearAdminSession,
} from '../api.js';

// ── Auth ──────────────────────────────────────────────────────────────────────
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
    await switchTab('users');
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

// ── Tab management ────────────────────────────────────────────────────────────
// Two-letter section codes (no emoji) for a restrained government-console look.
const TABS = [
  { id: 'users',     label: 'Users',      code: 'US' },
  { id: 'reports',   label: 'Reports',    code: 'RP' },
  { id: 'disasters', label: 'Disasters',  code: 'DS' },
  { id: 'links',     label: 'Links',      code: 'LK' },
  { id: 'devices',   label: 'Devices',    code: 'DV' },
  { id: 'audit',     label: 'Audit Log',  code: 'AU' },
];

const activeTab   = ref('users');
const loading     = ref(false);
const error       = ref(null);
const rows        = ref({});    // { tabId: [] }
const totals      = ref({});    // { tabId: number }
const stats       = ref(null);
const searchQ     = ref('');
const offset      = ref(0);
const PAGE        = 100;

// ── Per-tab column filters ──────────────────────────────────────────────────
// Empty string = "not set". A blank default per key is the reset baseline.
const FILTER_DEFAULTS = {
  users:     { role: '', user_type: '', consent: '', has_email: '' },
  reports:   { status: '', reported_by: '', user_type: '', disaster_id: '' },
  disasters: { active: '', type: '' },
  devices:   { platform: '', located: '', linked: '' },
  links:     { status: '' },
  audit:     { action: '', entity: '' },
};
function freshFilters() {
  return JSON.parse(JSON.stringify(FILTER_DEFAULTS));
}
const filters = ref(freshFilters());

// Static option lists for the dropdowns (severity-ordered where it matters).
const REPORT_STATUSES = ['need_help', 'injured', 'missing', 'verified_missing',
  'potentially_missing', 'awaiting_response', 'rescued', 'deceased', 'safe'];
const DISASTER_TYPES  = ['typhoon', 'flood', 'earthquake', 'landslide', 'fire', 'tsunami', 'other'];
// Populated lazily for the Reports → Disaster dropdown.
const disasterOptions = ref([]);

function filterParams(tab) {
  const f = filters.value[tab] || {};
  const p = {};
  for (const [k, v] of Object.entries(f)) if (v !== '') p[k] = v;
  return p;
}
function hasFilters(tab) {
  return Object.values(filters.value[tab] || {}).some((v) => v !== '');
}
function applyFilters(tab) {
  offset.value = 0;
  loadTab(tab, searchQ.value, 0);
}
function clearFilters(tab) {
  filters.value[tab] = { ...FILTER_DEFAULTS[tab] };
  applyFilters(tab);
}

async function ensureDisasterOptions() {
  if (disasterOptions.value.length) return;
  try {
    const res = await adminListDisasters();
    disasterOptions.value = res.rows || [];
  } catch { /* dropdown just stays empty */ }
}

async function switchTab(tab) {
  activeTab.value = tab;
  error.value     = null;
  searchQ.value   = '';
  offset.value    = 0;
  filters.value[tab] = { ...FILTER_DEFAULTS[tab] };
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

async function doSearch() {
  offset.value = 0;
  await loadTab(activeTab.value, searchQ.value, 0);
}

async function prevPage() {
  if (offset.value <= 0) return;
  offset.value = Math.max(0, offset.value - PAGE);
  await loadTab(activeTab.value, searchQ.value, offset.value);
}
async function nextPage() {
  const total = totals.value[activeTab.value] ?? 0;
  if (offset.value + PAGE >= total) return;
  offset.value += PAGE;
  await loadTab(activeTab.value, searchQ.value, offset.value);
}

// ── Form (shared create/edit panel) ──────────────────────────────────────────
const showForm  = ref(false);
const formMode  = ref('create');   // 'create' | 'edit'
const editId    = ref(null);
const formData  = ref({});
const formBusy  = ref(false);
const formError = ref(null);

const FORM_FIELDS = {
  users: [
    { key: 'phone',           label: 'Phone',           required: true },
    { key: 'name',            label: 'Name',            required: true },
    { key: 'email',           label: 'Email',           required: false },
    { key: 'personal_id',     label: 'HKID',            required: false },
    { key: 'role',            label: 'Role',            required: false, type: 'select',
      options: ['citizen','volunteer','government','super_admin'] },
    { key: 'user_type',       label: 'User Type',       required: false, type: 'select',
      options: ['mobile','web'] },
    { key: 'password',        label: 'Password',        required: false, type: 'password',
      note: 'Required for super_admin. Leave blank to keep existing.' },
    { key: 'privacy_consent', label: 'Privacy Consent', required: false, type: 'checkbox' },
  ],
  reports: [
    { key: 'name',          label: 'Name',          required: true },
    { key: 'status',        label: 'Status',        required: true, type: 'select',
      options: ['safe','injured','need_help','awaiting_response','potentially_missing',
                'missing','verified_missing','rescued','deceased'] },
    { key: 'lat',           label: 'Latitude',      required: true, type: 'number' },
    { key: 'lng',           label: 'Longitude',     required: true, type: 'number' },
    { key: 'phone',         label: 'Phone',         required: false },
    { key: 'personal_id',   label: 'HKID',          required: false },
    { key: 'medical_notes', label: 'Medical Notes', required: false, type: 'textarea' },
    { key: 'disaster_id',   label: 'Disaster ID',   required: false },
  ],
  disasters: [
    { key: 'type',        label: 'Type',        required: true, type: 'select',
      options: ['typhoon','flood','earthquake','landslide','fire','tsunami','other'] },
    { key: 'severity',    label: 'Severity 1–5',required: false, type: 'number' },
    { key: 'magnitude',   label: 'Magnitude',   required: false, type: 'number' },
    { key: 'lat',         label: 'Latitude',    required: true,  type: 'number' },
    { key: 'lng',         label: 'Longitude',   required: true,  type: 'number' },
    { key: 'radius_km',   label: 'Radius (km)', required: true,  type: 'number' },
    { key: 'description', label: 'Description', required: false, type: 'textarea' },
    { key: 'active',      label: 'Active',      required: false, type: 'checkbox' },
  ],
};

function openCreate(tab) {
  formMode.value  = 'create';
  editId.value    = null;
  formData.value  = tab === 'disasters' ? { active: true } : {};
  formError.value = null;
  showForm.value  = true;
}

function openEdit(tab, row) {
  formMode.value  = 'edit';
  editId.value    = row.id;
  formData.value  = { ...row };
  formError.value = null;
  showForm.value  = true;
}

function closeForm() { showForm.value = false; formData.value = {}; formError.value = null; }

async function submitForm() {
  formBusy.value  = true;
  formError.value = null;
  const tab = activeTab.value;
  try {
    if (tab === 'users') {
      if (formMode.value === 'create') await adminCreateUser(formData.value);
      else                             await adminUpdateUser(editId.value, formData.value);
    } else if (tab === 'reports') {
      if (formMode.value === 'create') await adminCreateReport(formData.value);
      else                             await adminUpdateReport(editId.value, formData.value);
    } else if (tab === 'disasters') {
      if (formMode.value === 'create') await adminCreateDisaster(formData.value);
      else                             await adminUpdateDisaster(editId.value, formData.value);
    }
    closeForm();
    await loadTab(tab, searchQ.value, offset.value);
  } catch (e) {
    formError.value = e.message || 'Save failed';
  } finally {
    formBusy.value = false;
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
const deleteTarget = ref(null);   // { tab, row }
const deleteBusy   = ref(false);

function confirmDelete(tab, row) { deleteTarget.value = { tab, row }; }

async function doDelete() {
  if (!deleteTarget.value) return;
  deleteBusy.value = true;
  const { tab, row } = deleteTarget.value;
  try {
    if (tab === 'users')     await adminDeleteUser(row.id);
    else if (tab === 'reports')   await adminDeleteReport(row.id);
    else if (tab === 'disasters') await adminDeleteDisaster(row.id);
    else if (tab === 'links')     await adminDeleteLink(row.id);
    else if (tab === 'devices')   await adminDeleteDevice(row.id);
    deleteTarget.value = null;
    await loadTab(tab, searchQ.value, offset.value);
  } catch (e) {
    error.value = e.message || 'Delete failed';
    deleteTarget.value = null;
  } finally {
    deleteBusy.value = false;
  }
}

// ── Inline link status edit ───────────────────────────────────────────────────
async function setLinkStatus(row, status) {
  try {
    await adminUpdateLink(row.id, { status });
    await loadTab('links', searchQ.value, offset.value);
  } catch (e) {
    error.value = e.message;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(ts) {
  if (!ts) return '—';
  return new Date(Number(ts)).toLocaleString('en-HK', { dateStyle: 'short', timeStyle: 'short' });
}
function shortId(id) { return id ? id.split('-')[0] : '—'; }
const currentRows = computed(() => rows.value[activeTab.value] ?? []);
const canPage      = computed(() => ['users','reports','links','devices'].includes(activeTab.value));
const total        = computed(() => totals.value[activeTab.value] ?? currentRows.value.length);
</script>

<template>
  <!-- ════════ LOGIN ════════ -->
  <div v-if="!adminToken" class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <div class="crest">報</div>
        <h1>Report Safe</h1>
        <p class="login-sub">Internal Administration Console</p>
        <div class="classification">RESTRICTED · GOVERNMENT USE ONLY</div>
      </div>
      <form @submit.prevent="login" class="login-form">
        <label class="field-label">Phone number</label>
        <input v-model="loginPhone" class="login-input" type="tel" placeholder="+852 9xxx xxxx"
               autocomplete="username" required />
        <label class="field-label" style="margin-top:14px">Password</label>
        <input v-model="loginPass" class="login-input" type="password" placeholder="••••••••"
               autocomplete="current-password" required />
        <div v-if="loginError" class="login-error">{{ loginError }}</div>
        <button class="login-btn" type="submit" :disabled="loginBusy">
          {{ loginBusy ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
      <p class="login-note">Restricted access — government personnel only</p>
    </div>
  </div>

  <!-- ════════ ADMIN PANEL ════════ -->
  <div v-else class="admin-wrap">

    <!-- Top toolbar -->
    <header class="admin-header">
      <div class="header-brand">
        <span class="header-crest">報</span>
        <span class="header-title">Report Safe</span>
        <span class="header-div">/</span>
        <span class="header-sub">Admin Console</span>
      </div>
      <div class="header-right">
        <span class="header-user">{{ adminUser?.name || adminUser?.phone }}</span>
        <button class="logout-btn" @click="logout">Sign out</button>
      </div>
    </header>

    <div class="admin-body">
      <!-- Sidebar -->
      <nav class="admin-sidebar">
        <button
          v-for="tab in TABS" :key="tab.id"
          class="nav-item"
          :class="{ active: activeTab === tab.id }"
          @click="switchTab(tab.id)"
        >
          <span class="nav-label">{{ tab.label }}</span>
        </button>
      </nav>

      <!-- Main content -->
      <main class="admin-main">

        <!-- Error banner -->
        <div v-if="error" class="err-banner">
          ⚠ {{ error }}
          <button @click="error = null" class="err-close">✕</button>
        </div>

        <!-- ── OVERVIEW ── -->
        <section v-if="activeTab === 'overview'">
          <h2 class="section-heading">Database Overview</h2>
          <div v-if="!stats && !loading" class="empty-msg">
            <button class="btn btn-primary" @click="loadTab('overview')">Load stats</button>
          </div>
          <div v-if="loading" class="loading-msg">Loading…</div>
          <div v-if="stats" class="stats-grid">
            <div class="stat-box">
              <div class="stat-num">{{ stats.users?.total ?? 0 }}</div>
              <div class="stat-lbl">Total Users</div>
              <div class="stat-sub">
                {{ stats.users?.citizen }} citizen ·
                {{ stats.users?.government }} gov ·
                {{ stats.users?.super_admin }} admin
              </div>
            </div>
            <div class="stat-box">
              <div class="stat-num">{{ stats.reports?.total ?? 0 }}</div>
              <div class="stat-lbl">Reports</div>
              <div class="stat-sub">
                {{ stats.reports?.safe }} safe ·
                {{ stats.reports?.injured }} injured ·
                {{ stats.reports?.need_help }} need help
              </div>
            </div>
            <div class="stat-box">
              <div class="stat-num">{{ stats.disasters?.total ?? 0 }}</div>
              <div class="stat-lbl">Disasters</div>
              <div class="stat-sub">{{ stats.disasters?.active }} currently active</div>
            </div>
            <div class="stat-box">
              <div class="stat-num">{{ stats.links?.total ?? 0 }}</div>
              <div class="stat-lbl">Account Links</div>
              <div class="stat-sub">
                {{ stats.links?.confirmed }} confirmed ·
                {{ stats.links?.pending }} pending
              </div>
            </div>
            <div class="stat-box">
              <div class="stat-num">{{ stats.devices?.total ?? 0 }}</div>
              <div class="stat-lbl">Registered Devices</div>
              <div class="stat-sub">push-enabled mobile devices</div>
            </div>
            <div class="stat-box">
              <div class="stat-num">{{ stats.audits?.total ?? 0 }}</div>
              <div class="stat-lbl">Audit Events</div>
              <div class="stat-sub">all admin actions logged</div>
            </div>
          </div>
        </section>

        <!-- ── USERS ── -->
        <section v-if="activeTab === 'users'">
          <div class="tbl-toolbar">
            <h2 class="section-heading">Users</h2>
            <div class="toolbar-right">
              <form @submit.prevent="doSearch" class="search-form">
                <input v-model="searchQ" class="search-input" placeholder="Search name / phone…" />
                <button class="btn btn-sm" type="submit">Search</button>
              </form>
              <button class="btn btn-primary btn-sm" @click="openCreate('users')">+ New User</button>
            </div>
          </div>
          <div class="filter-bar">
            <select v-model="filters.users.role" class="filter-select" @change="applyFilters('users')">
              <option value="">Role · all</option>
              <option value="citizen">Citizen</option>
              <option value="volunteer">Volunteer</option>
              <option value="government">Government</option>
              <option value="super_admin">Super Admin</option>
            </select>
            <select v-model="filters.users.user_type" class="filter-select" @change="applyFilters('users')">
              <option value="">Type · all</option>
              <option value="mobile">Mobile</option>
              <option value="web">Web</option>
            </select>
            <select v-model="filters.users.consent" class="filter-select" @change="applyFilters('users')">
              <option value="">Consent · any</option>
              <option value="true">Consent given</option>
              <option value="false">No consent</option>
            </select>
            <select v-model="filters.users.has_email" class="filter-select" @change="applyFilters('users')">
              <option value="">Email · any</option>
              <option value="true">Has email</option>
              <option value="false">No email</option>
            </select>
            <button v-if="hasFilters('users')" class="filter-clear" @click="clearFilters('users')">✕ Clear</button>
          </div>
          <div v-if="loading" class="loading-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="empty-msg">No users found.</div>
          <div v-else class="tbl-wrap">
            <table class="data-tbl">
              <thead>
                <tr>
                  <th>ID</th><th>Phone</th><th>Name</th><th>Email</th>
                  <th>HKID</th><th>Role</th><th>Type</th><th>Consent</th>
                  <th>Created</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in currentRows" :key="u.id">
                  <td class="mono" :title="u.id">{{ shortId(u.id) }}</td>
                  <td>{{ u.phone }}</td>
                  <td>{{ u.name || '—' }}</td>
                  <td>{{ u.email || '—' }}</td>
                  <td class="mono">{{ u.personal_id || '—' }}</td>
                  <td><span class="role-badge" :class="'role-' + u.role">{{ u.role }}</span></td>
                  <td>{{ u.user_type }}</td>
                  <td>{{ u.privacy_consent ? '✓' : '✗' }}</td>
                  <td class="small-date">{{ fmt(u.created_at) }}</td>
                  <td class="actions">
                    <button class="btn btn-xs btn-edit" @click="openEdit('users', u)">Edit</button>
                    <button class="btn btn-xs btn-del"  @click="confirmDelete('users', u)">Del</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ── REPORTS ── -->
        <section v-if="activeTab === 'reports'">
          <div class="tbl-toolbar">
            <h2 class="section-heading">Status Reports</h2>
            <div class="toolbar-right">
              <form @submit.prevent="doSearch" class="search-form">
                <input v-model="searchQ" class="search-input" placeholder="Search name / phone…" />
                <button class="btn btn-sm" type="submit">Search</button>
              </form>
              <button class="btn btn-primary btn-sm" @click="openCreate('reports')">+ New Report</button>
            </div>
          </div>
          <div class="filter-bar">
            <select v-model="filters.reports.status" class="filter-select" @change="applyFilters('reports')">
              <option value="">Status · all</option>
              <option v-for="s in REPORT_STATUSES" :key="s" :value="s">{{ s.replace(/_/g, ' ') }}</option>
            </select>
            <select v-model="filters.reports.reported_by" class="filter-select" @change="applyFilters('reports')">
              <option value="">Source · all</option>
              <option value="self">Self-reported</option>
              <option value="family">By family</option>
            </select>
            <select v-model="filters.reports.user_type" class="filter-select" @change="applyFilters('reports')">
              <option value="">Origin · all</option>
              <option value="mobile">Mobile</option>
              <option value="web">Web</option>
            </select>
            <select v-model="filters.reports.disaster_id" class="filter-select" @change="applyFilters('reports')">
              <option value="">Disaster · all</option>
              <option value="__any__">In any disaster zone</option>
              <option value="__none__">No disaster zone</option>
              <option v-for="d in disasterOptions" :key="d.id" :value="d.id">
                {{ d.type }} — {{ shortId(d.id) }}
              </option>
            </select>
            <button v-if="hasFilters('reports')" class="filter-clear" @click="clearFilters('reports')">✕ Clear</button>
          </div>
          <div v-if="loading" class="loading-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="empty-msg">No reports found.</div>
          <div v-else class="tbl-wrap">
            <table class="data-tbl">
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>Status</th>
                  <th>Lat</th><th>Lng</th><th>Phone</th><th>HKID</th>
                  <th>Medical Notes</th><th>Linked User</th>
                  <th>Relays</th><th>Updated</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in currentRows" :key="r.id">
                  <td class="mono" :title="r.id">{{ shortId(r.id) }}</td>
                  <td>
                    {{ r.user_name || r.name }}
                    <span v-if="r.user_name && r.name && r.user_name !== r.name" class="dim" style="font-size:11px;"> (rpt: {{ r.name }})</span>
                  </td>
                  <td><span class="status-badge" :class="'st-' + r.status">{{ r.status }}</span></td>
                  <td class="mono">{{ Number(r.lat).toFixed(4) }}</td>
                  <td class="mono">{{ Number(r.lng).toFixed(4) }}</td>
                  <td>{{ r.phone || '—' }}</td>
                  <td class="mono">{{ r.personal_id || '—' }}</td>
                  <td class="notes-cell">{{ r.medical_notes || '—' }}</td>
                  <td>{{ r.user_name || '—' }}<br v-if="r.user_name" /><span class="dim">{{ r.user_phone || '' }}</span></td>
                  <td>{{ r.relay_count }}</td>
                  <td class="small-date">{{ fmt(r.updated_at) }}</td>
                  <td class="actions">
                    <button class="btn btn-xs btn-edit" @click="openEdit('reports', r)">Edit</button>
                    <button class="btn btn-xs btn-del"  @click="confirmDelete('reports', r)">Del</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ── DISASTERS ── -->
        <section v-if="activeTab === 'disasters'">
          <div class="tbl-toolbar">
            <h2 class="section-heading">Disasters</h2>
            <div class="toolbar-right">
              <button class="btn btn-primary btn-sm" @click="openCreate('disasters')">+ New Disaster</button>
            </div>
          </div>
          <div class="filter-bar">
            <select v-model="filters.disasters.active" class="filter-select" @change="applyFilters('disasters')">
              <option value="">Status · all</option>
              <option value="true">Active</option>
              <option value="false">Ended</option>
            </select>
            <select v-model="filters.disasters.type" class="filter-select" @change="applyFilters('disasters')">
              <option value="">Type · all</option>
              <option v-for="t in DISASTER_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
            <button v-if="hasFilters('disasters')" class="filter-clear" @click="clearFilters('disasters')">✕ Clear</button>
          </div>
          <div v-if="loading" class="loading-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="empty-msg">No disasters found.</div>
          <div v-else class="tbl-wrap">
            <table class="data-tbl">
              <thead>
                <tr>
                  <th>ID</th><th>Type</th><th>Severity</th><th>Magnitude</th>
                  <th>Lat</th><th>Lng</th><th>Radius km</th>
                  <th>Description</th><th>Active</th><th>Started</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in currentRows" :key="d.id">
                  <td class="mono" :title="d.id">{{ shortId(d.id) }}</td>
                  <td>{{ d.type }}</td>
                  <td>{{ d.severity ?? '—' }}</td>
                  <td>{{ d.magnitude ?? '—' }}</td>
                  <td class="mono">{{ Number(d.lat).toFixed(4) }}</td>
                  <td class="mono">{{ Number(d.lng).toFixed(4) }}</td>
                  <td>{{ d.radius_km }}</td>
                  <td class="notes-cell">{{ d.description || '—' }}</td>
                  <td>
                    <span :class="d.active ? 'pill-green' : 'pill-grey'">
                      {{ d.active ? 'Active' : 'Ended' }}
                    </span>
                  </td>
                  <td class="small-date">{{ fmt(d.started_at) }}</td>
                  <td class="actions">
                    <button class="btn btn-xs btn-edit" @click="openEdit('disasters', d)">Edit</button>
                    <button class="btn btn-xs btn-del"  @click="confirmDelete('disasters', d)">Del</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ── LINKS ── -->
        <section v-if="activeTab === 'links'">
          <div class="tbl-toolbar">
            <h2 class="section-heading">Account Links</h2>
            <div class="toolbar-right">
              <form @submit.prevent="doSearch" class="search-form">
                <input v-model="searchQ" class="search-input" placeholder="Search name / phone…" />
                <button class="btn btn-sm" type="submit">Search</button>
              </form>
            </div>
          </div>
          <div class="filter-bar">
            <select v-model="filters.links.status" class="filter-select" @change="applyFilters('links')">
              <option value="">Status · all</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="blocked">Blocked</option>
            </select>
            <button v-if="hasFilters('links')" class="filter-clear" @click="clearFilters('links')">✕ Clear</button>
          </div>
          <div v-if="loading" class="loading-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="empty-msg">No links found.</div>
          <div v-else class="tbl-wrap">
            <table class="data-tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User A</th><th>Phone A</th>
                  <th>User B</th><th>Phone B</th>
                  <th>Status</th><th>Confirmed</th><th>Created</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="l in currentRows" :key="l.id">
                  <td class="mono" :title="l.id">{{ shortId(l.id) }}</td>
                  <td>{{ l.user_a_name || '—' }}</td>
                  <td>{{ l.user_a_phone }}</td>
                  <td>{{ l.user_b_name || '—' }}</td>
                  <td>{{ l.user_b_phone }}</td>
                  <td>
                    <select class="inline-select" :value="l.status" @change="setLinkStatus(l, $event.target.value)">
                      <option value="pending">pending</option>
                      <option value="confirmed">confirmed</option>
                      <option value="blocked">blocked</option>
                    </select>
                  </td>
                  <td class="small-date">{{ fmt(l.confirmed_at) }}</td>
                  <td class="small-date">{{ fmt(l.created_at) }}</td>
                  <td class="actions">
                    <button class="btn btn-xs btn-del" @click="confirmDelete('links', l)">Del</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ── DEVICES ── -->
        <section v-if="activeTab === 'devices'">
          <div class="tbl-toolbar">
            <h2 class="section-heading">Device Push Tokens</h2>
          </div>
          <div class="filter-bar">
            <select v-model="filters.devices.platform" class="filter-select" @change="applyFilters('devices')">
              <option value="">Platform · all</option>
              <option value="ios">iOS</option>
              <option value="android">Android</option>
            </select>
            <select v-model="filters.devices.located" class="filter-select" @change="applyFilters('devices')">
              <option value="">Location · any</option>
              <option value="true">Has GPS (push-targetable)</option>
              <option value="false">No GPS</option>
            </select>
            <select v-model="filters.devices.linked" class="filter-select" @change="applyFilters('devices')">
              <option value="">Account · any</option>
              <option value="true">Linked to user</option>
              <option value="false">Unlinked</option>
            </select>
            <button v-if="hasFilters('devices')" class="filter-clear" @click="clearFilters('devices')">✕ Clear</button>
          </div>
          <div v-if="loading" class="loading-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="empty-msg">No devices found.</div>
          <div v-else class="tbl-wrap">
            <table class="data-tbl">
              <thead>
                <tr>
                  <th>ID</th><th>User</th><th>Phone</th>
                  <th>Platform</th><th>Token (prefix)</th>
                  <th>Lat</th><th>Lng</th><th>Updated</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in currentRows" :key="d.id">
                  <td class="mono" :title="d.id">{{ shortId(d.id) }}</td>
                  <td>{{ d.user_name || '—' }}</td>
                  <td>{{ d.user_phone || '—' }}</td>
                  <td>{{ d.platform }}</td>
                  <td class="mono dim">{{ d.token?.slice(0, 20) }}…</td>
                  <td>{{ d.lat != null ? Number(d.lat).toFixed(4) : '—' }}</td>
                  <td>{{ d.lng != null ? Number(d.lng).toFixed(4) : '—' }}</td>
                  <td class="small-date">{{ fmt(d.updated_at) }}</td>
                  <td class="actions">
                    <button class="btn btn-xs btn-del" @click="confirmDelete('devices', d)">Del</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ── AUDIT LOG ── -->
        <section v-if="activeTab === 'audit'">
          <div class="tbl-toolbar">
            <h2 class="section-heading">Audit Log</h2>
            <button class="btn btn-sm" @click="loadTab('audit', '', 0)">Refresh</button>
          </div>
          <div class="filter-bar">
            <select v-model="filters.audit.action" class="filter-select" @change="applyFilters('audit')">
              <option value="">Action · all</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="login">Login</option>
            </select>
            <select v-model="filters.audit.entity" class="filter-select" @change="applyFilters('audit')">
              <option value="">Entity · all</option>
              <option value="users">Users</option>
              <option value="reports">Reports</option>
              <option value="disasters">Disasters</option>
              <option value="account_links">Account links</option>
              <option value="device_push_tokens">Devices</option>
            </select>
            <button v-if="hasFilters('audit')" class="filter-clear" @click="clearFilters('audit')">✕ Clear</button>
          </div>
          <div v-if="loading" class="loading-msg">Loading…</div>
          <div v-else-if="!currentRows.length" class="empty-msg">No audit events yet.</div>
          <div v-else class="tbl-wrap">
            <table class="data-tbl">
              <thead>
                <tr><th>Time</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Actor</th><th>Details</th></tr>
              </thead>
              <tbody>
                <tr v-for="a in currentRows" :key="a.id">
                  <td class="small-date">{{ fmt(a.created_at) }}</td>
                  <td><span class="action-badge" :class="'act-' + a.action">{{ a.action }}</span></td>
                  <td>{{ a.entity }}</td>
                  <td class="mono dim" :title="a.entity_id">{{ shortId(a.entity_id) }}</td>
                  <td>{{ a.actor }}</td>
                  <td class="notes-cell dim">{{ a.details || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Pagination -->
        <div v-if="canPage && !loading" class="pagination">
          <span class="page-info">
            {{ offset + 1 }}–{{ Math.min(offset + PAGE, total) }} of {{ total }}
          </span>
          <button class="btn btn-sm" :disabled="offset <= 0" @click="prevPage">← Prev</button>
          <button class="btn btn-sm" :disabled="offset + PAGE >= total" @click="nextPage">Next →</button>
        </div>

      </main>
    </div>

    <!-- ════ CREATE / EDIT MODAL ════ -->
    <div v-if="showForm" class="modal-overlay" @click.self="closeForm">
      <div class="modal-card">
        <div class="modal-header">
          <h3>{{ formMode === 'create' ? 'New' : 'Edit' }} {{ activeTab.replace(/s$/, '') }}</h3>
          <button class="modal-close" @click="closeForm">✕</button>
        </div>
        <form @submit.prevent="submitForm" class="modal-form">
          <template v-for="field in FORM_FIELDS[activeTab] || []" :key="field.key">
            <label class="field-label">
              {{ field.label }}
              <span v-if="field.required" class="req">*</span>
              <span v-if="field.note" class="field-note"> — {{ field.note }}</span>
            </label>
            <textarea v-if="field.type === 'textarea'" v-model="formData[field.key]"
                      class="login-input" rows="3" :placeholder="field.label" />
            <select v-else-if="field.type === 'select'" v-model="formData[field.key]"
                    class="login-input">
              <option value="">— select —</option>
              <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
            </select>
            <label v-else-if="field.type === 'checkbox'" class="checkbox-row">
              <input type="checkbox" v-model="formData[field.key]" />
              {{ field.label }}
            </label>
            <input v-else v-model="formData[field.key]" class="login-input"
                   :type="field.type || 'text'" :placeholder="field.label"
                   :required="field.required && formMode === 'create'" />
          </template>
          <div v-if="formError" class="login-error">{{ formError }}</div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" @click="closeForm">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="formBusy">
              {{ formBusy ? 'Saving…' : (formMode === 'create' ? 'Create' : 'Save changes') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ════ DELETE CONFIRM ════ -->
    <div v-if="deleteTarget" class="modal-overlay" @click.self="deleteTarget = null">
      <div class="modal-card modal-sm">
        <div class="modal-header">
          <h3>Confirm deletion</h3>
          <button class="modal-close" @click="deleteTarget = null">✕</button>
        </div>
        <p class="confirm-msg">
          Permanently delete this
          <strong>{{ deleteTarget.tab.replace(/s$/, '') }}</strong>?
          This cannot be undone.
        </p>
        <div class="modal-actions">
          <button class="btn btn-ghost" @click="deleteTarget = null">Cancel</button>
          <button class="btn btn-danger" :disabled="deleteBusy" @click="doDelete">
            {{ deleteBusy ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── Layout ────────────────────────────────────────────────── */
.admin-wrap { display:flex; flex-direction:column; height:100vh; background:#e9f0fb; font-family:system-ui,sans-serif; font-size:14px; }
.admin-body { display:flex; flex:1; overflow:hidden; }

/* ── Top toolbar (dark) ──────────────────────────────────────── */
.admin-header { display:flex; align-items:center; justify-content:space-between;
  padding:0 22px; height:54px; background:#16335a; color:#fff; flex-shrink:0; }
.header-brand { display:flex; align-items:center; gap:10px; }
.header-crest { display:flex; align-items:center; justify-content:center; width:30px; height:30px;
  background:#2f6fb0; color:#fff; font-size:17px; font-weight:700; border-radius:7px; }
.header-title { font-size:15px; font-weight:700; letter-spacing:.3px; }
.header-div   { color:#4a6a8c; font-weight:300; }
.header-sub   { font-size:13px; color:#9fc0e4; font-weight:500; }
.header-right { display:flex; align-items:center; gap:12px; }
.header-user  { font-size:13px; color:#9fc0e4; }
.logout-btn   { padding:6px 14px; background:transparent; border:1px solid #3f6694;
  color:#9fc0e4; border-radius:7px; cursor:pointer; font-size:13px; }
.logout-btn:hover { background:#23456e; color:#fff; }

/* ── Sidebar (dark) ──────────────────────────────────────────── */
.admin-sidebar { width:200px; background:#1c3c63; display:flex; flex-direction:column;
  padding:14px 10px; gap:3px; flex-shrink:0; overflow-y:auto; }
.nav-item { display:flex; align-items:center; gap:11px; padding:10px 12px;
  background:transparent; border:none; color:#a8c4e2; cursor:pointer;
  text-align:left; font-size:13.5px; font-weight:600; border-radius:3px;
  transition:background .12s, color .12s; width:100%; }
.nav-item:hover  { background:rgba(255,255,255,.07); color:#fff; }
.nav-item.active { background:#2f6fb0; color:#fff; }
.nav-label { flex:1; }

/* ── Main (light blue, no outer card) ────────────────────────── */
.admin-main { flex:1; overflow:auto; padding:24px 26px; }

/* ── Section heading ─────────────────────────────────────────── */
.section-heading { font-size:19px; font-weight:700; color:#16335a; margin:0; }

/* ── Toolbar ─────────────────────────────────────────────────── */
.tbl-toolbar  { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; gap:12px; }
.toolbar-right { display:flex; align-items:center; gap:10px; }
.search-form  { display:flex; gap:6px; }
.search-input { padding:8px 12px; border:1px solid #b6c4d6; border-radius:3px;
  font-size:13px; width:210px; background:#fff; }
.search-input:focus { outline:none; border-color:#1f4e87; }

/* ── Data container — same shape as the Shelters table, navy header ── */
.tbl-wrap { overflow:auto; border:1px solid #c3d2e4; background:#fff; border-radius:6px; }
.data-tbl { width:100%; border-collapse:collapse; font-size:13px; font-variant-numeric:tabular-nums; }
.data-tbl th { background:#1f4e87; color:#fff; font-weight:700; font-size:11.5px;
  text-transform:uppercase; letter-spacing:.4px; padding:12px 15px;
  border-bottom:1px solid #173e6c; text-align:left; white-space:nowrap; }
.data-tbl td { padding:11px 15px; border-bottom:1px solid #eef3f9; vertical-align:middle; }
.data-tbl tr:last-child td { border-bottom:none; }
.data-tbl tr:hover td { background:#f5f9ff; }
.mono       { font-family:monospace; font-size:12px; color:#555; }
.dim        { color:#8a9ab0; }
.small-date { font-size:12px; color:#8a9ab0; white-space:nowrap; }
.notes-cell { max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.actions    { white-space:nowrap; }

/* ── Badges ──────────────────────────────────────────────────── */
/* Role is metadata, not status → mono. Colour is reserved for report status. */
.role-badge    { padding:2px 8px; border-radius:3px; font-size:11px; font-weight:700;
  text-transform:uppercase; letter-spacing:.4px; background:#eef1f6; color:#3a4a5e;
  border:1px solid #d8dfe8; }

/* Safe = green, Rescued = blue. Every other status is red, graduated by
   importance — darker red = more important (missing > need_help > injured >
   potentially_missing > awaiting_response > deceased). */
.status-badge { padding:2px 8px; border-radius:3px; font-size:11px; font-weight:700; background:#fde8e8; }
.st-safe      { background:#e8f9ee; color:#1a7a3f; }
.st-rescued   { background:#e8f4fd; color:#1a7abf; }
.st-missing, .st-verified_missing { color:#5c0d0d; }
.st-need_help           { color:#7d1818; }
.st-injured             { color:#9c2424; }
.st-potentially_missing { color:#b53636; }
.st-awaiting_response   { color:#c75050; }
.st-deceased            { color:#cf6a6a; }

.pill-green { padding:2px 8px; border-radius:3px; font-size:11px; font-weight:700;
  background:#e8f9ee; color:#1a7a3f; }
.pill-grey  { padding:2px 8px; border-radius:3px; font-size:11px; font-weight:700;
  background:#f0f0f0; color:#666; }

/* Audit action is metadata, not status → mono. */
.action-badge { padding:2px 8px; border-radius:3px; font-size:11px; font-weight:700;
  background:#eef1f6; color:#3a4a5e; border:1px solid #d8dfe8; }

/* ── Buttons ─────────────────────────────────────────────────── */
/* One institutional blue for every button. Filled = primary action,
   outline = secondary; danger stays red as a destructive-action safety signal. */
.btn { padding:8px 15px; border-radius:3px; cursor:pointer;
  font-size:13px; font-weight:600; transition:background .12s, opacity .12s;
  background:#fff; color:#1f4e87; border:1px solid #1f4e87; }
.btn:hover:not(:disabled) { background:#eef3fa; }
.btn:disabled { opacity:.5; cursor:not-allowed; }
.btn-primary  { background:#1f4e87; color:#fff; }
.btn-primary:hover:not(:disabled) { background:#173e6c; }
.btn-ghost    { background:#fff; color:#1f4e87; border-color:#1f4e87; }
.btn-ghost:hover:not(:disabled)  { background:#eef3fa; }
.btn-danger   { background:#a5281b; color:#fff; border-color:#a5281b; }
.btn-danger:hover:not(:disabled) { background:#871f15; }
.btn-sm       { padding:7px 13px; font-size:12.5px; }
.btn-xs       { padding:4px 9px; font-size:11px; }
.btn-edit     { background:#1f4e87; color:#fff; }
.btn-edit:hover:not(:disabled) { background:#173e6c; }
.btn-del      { background:#fff; color:#1f4e87; border-color:#1f4e87; }
.btn-del:hover:not(:disabled)  { background:#eef3fa; }

/* ── Filter bar (compact, grouped — used by Users/Reports/Disasters/Devices) ── */
.filter-bar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
.filter-select { padding:6px 9px; border:1px solid #b6c4d6; border-radius:3px;
  font-size:12.5px; line-height:1.3; background:#fff; color:#33455c; cursor:pointer;
  max-width:190px; }
.filter-select:hover  { border-color:#7e98b6; }
.filter-select:focus  { outline:none; border-color:#1f4e87; }
.filter-clear { margin-left:auto; padding:6px 11px; font-size:12.5px; font-weight:600;
  background:transparent; border:none; color:#1f4e87; cursor:pointer; border-radius:3px; }
.filter-clear:hover { background:#eef3fa; }

/* ── Inline link select ──────────────────────────────────────── */
.inline-select { font-size:12px; padding:4px 7px; border:1px solid #dbe2ec;
  border-radius:6px; background:#fff; }

/* ── Stats grid ──────────────────────────────────────────────── */
.stats-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; margin-top:16px; }
.stat-box   { background:#fff; border:1px solid #c3d2e4; border-radius:6px; padding:20px; }
.stat-num   { font-size:32px; font-weight:800; color:#16335a; line-height:1; }
.stat-lbl   { font-size:13px; font-weight:700; color:#5a6b80; margin-top:4px; }
.stat-sub   { font-size:11px; color:#8a9ab0; margin-top:6px; }

/* ── Pagination (borderless — no extra container) ────────────── */
.pagination { display:flex; align-items:center; gap:10px; margin-top:14px; padding:0 2px; }
.page-info  { font-size:12.5px; color:#5a7090; margin-right:auto; font-weight:500; }

/* ── Error / loading ─────────────────────────────────────────── */
.err-banner { display:flex; align-items:center; gap:10px; padding:10px 14px;
  background:#fde8e8; border:1px solid #f0b8b8; border-radius:8px; color:#c0392b;
  font-weight:600; margin-bottom:14px; }
.err-close  { margin-left:auto; background:none; border:none; cursor:pointer;
  color:#c0392b; font-size:16px; }
.loading-msg { color:#8a9ab0; padding:20px 0; }
.empty-msg   { color:#8a9ab0; padding:20px 0; display:flex; gap:12px; align-items:center; }

/* ── Login ───────────────────────────────────────────────────── */
.login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center;
  background:linear-gradient(135deg,#0f2a48 0%,#1a5280 100%); }
.login-card { width:380px; background:#fff; border-radius:8px; padding:40px 36px;
  border-top:4px solid #1a3a5c; box-shadow:0 10px 40px rgba(0,0,0,.3); }
.login-logo { text-align:center; margin-bottom:28px; }
.crest      { display:inline-flex; align-items:center; justify-content:center; width:52px; height:52px;
  background:#1a3a5c; color:#fff; font-size:28px; font-weight:700; border-radius:6px; margin-bottom:14px; }
.login-logo h1 { font-size:21px; font-weight:800; color:#1a3a5c; margin:0; letter-spacing:.3px; }
.login-sub  { font-size:13px; color:#8a9ab0; margin:4px 0 0; }
.classification { margin-top:14px; font-size:10px; font-weight:700; letter-spacing:1px;
  color:#c0392b; padding:5px 0; border-top:1px solid #eef0f3; border-bottom:1px solid #eef0f3; }
.login-form    { display:flex; flex-direction:column; }
.field-label   { font-size:12px; font-weight:700; color:#4a6280; margin-bottom:4px;
  text-transform:uppercase; letter-spacing:.4px; }
.field-note    { font-size:11px; text-transform:none; color:#8a9ab0; font-weight:400; }
.login-input   { padding:10px 13px; border:1px solid #c5d3e0; border-radius:7px;
  font-size:14px; color:#1a3a5c; background:#fff; width:100%;
  box-sizing:border-box; transition:border-color .15s; }
.login-input:focus { outline:none; border-color:#1a7abf; }
.login-error { margin:10px 0 0; padding:8px 12px; background:#fde8e8;
  border-radius:6px; font-size:13px; color:#c0392b; font-weight:600; }
.login-btn   { margin-top:20px; padding:12px; background:#1a3a5c; color:#fff;
  border:none; border-radius:8px; font-size:15px; font-weight:700;
  cursor:pointer; transition:background .15s; }
.login-btn:hover:not(:disabled) { background:#0f2a48; }
.login-btn:disabled { opacity:.6; cursor:not-allowed; }
.login-note  { text-align:center; font-size:12px; color:#8a9ab0; margin-top:20px; }

/* ── Modal ───────────────────────────────────────────────────── */
.modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45);
  display:flex; align-items:center; justify-content:center; z-index:1000; }
.modal-card  { background:#fff; border-radius:12px; width:480px; max-width:96vw;
  max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,.25); }
.modal-sm    { width:380px; }
.modal-header{ display:flex; align-items:center; justify-content:space-between;
  padding:18px 22px 14px; border-bottom:1px solid #e8eef4; }
.modal-header h3 { margin:0; font-size:16px; font-weight:700; color:#1a3a5c; }
.modal-close { background:none; border:none; font-size:18px; cursor:pointer; color:#8a9ab0; }
.modal-form  { display:flex; flex-direction:column; gap:8px; padding:18px 22px; }
.modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:12px;
  padding-top:14px; border-top:1px solid #e8eef4; }
.req         { color:#c0392b; }
.checkbox-row { display:flex; align-items:center; gap:8px; font-size:13px; color:#4a6280;
  font-weight:600; cursor:pointer; }
.confirm-msg { padding:16px 22px; color:#4a6280; line-height:1.5; margin:0; }
</style>
