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
import LoginPanel from '../components/LoginPanel.vue';
import DataTable from '../components/DataTable.vue';
import StatusBadge from '../components/StatusBadge.vue';
import AppIcon from '../components/AppIcon.vue';
import { STATUS_COLOR_VIVID } from '../iconography.js';
import { useFocusTrap } from '../composables/useFocusTrap.js';

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

function fmt(ts) { if (!ts) return '—'; return new Date(Number(ts)).toLocaleString('en-HK', { dateStyle: 'short', timeStyle: 'short' }); }
function shortId(id) { return id ? id.split('-')[0] : '—'; }
const dash = (v) => v || '—';

/**
 * Declarative tab registry — drives the one generic loader below plus the
 * DataTable columns, modal form and delete action for every tab.
 *  - fetch(params):  list call; params = q? + limit/offset? + active filters
 *  - searchable:     tab sends the free-text q param
 *  - paged:          tab sends limit/offset and tracks res.total (shows pager)
 *  - columns:        DataTable spec; cells with markup override via slots
 *  - form:           { fields, create, update } for the modal (creatable tabs)
 *  - remove(id):     delete call for the confirm dialog
 */
const TAB_CONFIG = {
  overview: {
    load: async () => { stats.value = await adminGetStats(); },
  },
  users: {
    fetch: adminListUsers,
    searchable: true,
    paged: true,
    columns: [
      { key: 'id', label: 'ID', tdClass: 'mono', title: (r) => r.id, format: shortId },
      { key: 'phone', label: 'Phone' },
      { key: 'name', label: 'Name', format: dash },
      { key: 'gender', label: 'Gender', format: dash },
      { key: 'email', label: 'Email', format: dash },
      { key: 'personal_id', label: 'HKID', tdClass: 'mono', format: dash },
      { key: 'role', label: 'Role' },
      { key: 'user_type', label: 'Type' },
      { key: 'privacy_consent', label: 'Consent', format: (v) => (v ? 'Y' : 'N') },
      { key: 'created_at', label: 'Created', tdClass: 'ts', format: fmt },
      { key: 'actions', label: '', tdClass: 'acts' },
    ],
    form: {
      fields: [
        { key: 'phone', label: 'Phone', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'gender', label: 'Gender', required: false, type: 'select', options: ['male', 'female'] },
        { key: 'email', label: 'Email', required: false },
        { key: 'personal_id', label: 'HKID', required: false },
        { key: 'role', label: 'Role', required: false, type: 'select', options: ['citizen','volunteer','government','super_admin'] },
        { key: 'user_type', label: 'User Type', required: false, type: 'select', options: ['mobile','web'] },
        { key: 'password', label: 'Password', required: false, type: 'password', note: 'Required for super_admin' },
        { key: 'privacy_consent', label: 'Privacy Consent', required: false, type: 'checkbox' },
      ],
      create: adminCreateUser,
      update: adminUpdateUser,
    },
    remove: adminDeleteUser,
  },
  reports: {
    fetch: adminListReports,
    searchable: true,
    paged: true,
    columns: [
      { key: 'id', label: 'ID', tdClass: 'mono', title: (r) => r.id, format: shortId },
      { key: 'name', label: 'Name' },
      { key: 'status', label: 'Status' },
      { key: 'lat', label: 'Lat', tdClass: 'mono', format: (v) => Number(v).toFixed(4) },
      { key: 'lng', label: 'Lng', tdClass: 'mono', format: (v) => Number(v).toFixed(4) },
      { key: 'phone', label: 'Phone', format: dash },
      { key: 'personal_id', label: 'HKID', tdClass: 'mono', format: dash },
      { key: 'medical_notes', label: 'Medical', tdClass: 'clip', format: dash },
      { key: 'linked', label: 'Linked User' },
      { key: 'relay_count', label: 'Relays' },
      { key: 'updated_at', label: 'Updated', tdClass: 'ts', format: fmt },
      { key: 'actions', label: '', tdClass: 'acts' },
    ],
    form: {
      fields: [
        { key: 'name', label: 'Name', required: true },
        { key: 'status', label: 'Status', required: true, type: 'select', options: ['safe','injured','need_help','awaiting_response','potentially_missing','missing','verified_missing','rescued','deceased'] },
        { key: 'lat', label: 'Latitude', required: true, type: 'number' },
        { key: 'lng', label: 'Longitude', required: true, type: 'number' },
        { key: 'phone', label: 'Phone', required: false },
        { key: 'personal_id', label: 'HKID', required: false },
        { key: 'medical_notes', label: 'Medical Notes', required: false, type: 'textarea' },
        { key: 'disaster_id', label: 'Disaster ID', required: false },
      ],
      create: adminCreateReport,
      update: adminUpdateReport,
    },
    remove: adminDeleteReport,
  },
  disasters: {
    fetch: adminListDisasters,
    columns: [
      { key: 'id', label: 'ID', tdClass: 'mono', title: (r) => r.id, format: shortId },
      { key: 'type', label: 'Type' },
      { key: 'severity', label: 'Severity', format: (v) => v ?? '—' },
      { key: 'magnitude', label: 'Magnitude', format: (v) => v ?? '—' },
      { key: 'lat', label: 'Lat', tdClass: 'mono', format: (v) => Number(v).toFixed(4) },
      { key: 'lng', label: 'Lng', tdClass: 'mono', format: (v) => Number(v).toFixed(4) },
      { key: 'radius_km', label: 'Radius', format: (v) => `${v ?? ''}km` },
      { key: 'description', label: 'Description', tdClass: 'clip', format: dash },
      { key: 'active', label: 'Active', format: (v) => (v ? 'Y' : 'N') },
      { key: 'started_at', label: 'Started', tdClass: 'ts', format: fmt },
      { key: 'actions', label: '', tdClass: 'acts' },
    ],
    form: {
      fields: [
        { key: 'type', label: 'Type', required: true, type: 'select', options: ['typhoon','flood','earthquake','landslide','fire','tsunami','other'] },
        { key: 'severity', label: 'Severity 1–5', required: false, type: 'number' },
        { key: 'magnitude', label: 'Magnitude', required: false, type: 'number' },
        { key: 'lat', label: 'Latitude', required: true, type: 'number' },
        { key: 'lng', label: 'Longitude', required: true, type: 'number' },
        { key: 'radius_km', label: 'Radius (km)', required: true, type: 'number' },
        { key: 'description', label: 'Description', required: false, type: 'textarea' },
        { key: 'active', label: 'Active', required: false, type: 'checkbox' },
      ],
      create: adminCreateDisaster,
      update: adminUpdateDisaster,
    },
    remove: adminDeleteDisaster,
  },
  links: {
    fetch: adminListLinks,
    searchable: true,
    paged: true,
    columns: [
      { key: 'id', label: 'ID', tdClass: 'mono', title: (r) => r.id, format: shortId },
      { key: 'user_a_name', label: 'User A', format: dash },
      { key: 'user_a_phone', label: 'Phone A' },
      { key: 'user_b_name', label: 'User B', format: dash },
      { key: 'user_b_phone', label: 'Phone B' },
      { key: 'status', label: 'Status' },
      { key: 'confirmed_at', label: 'Confirmed', tdClass: 'ts', format: fmt },
      { key: 'created_at', label: 'Created', tdClass: 'ts', format: fmt },
      { key: 'actions', label: '', tdClass: 'acts' },
    ],
    remove: adminDeleteLink,
  },
  devices: {
    fetch: adminListDevices,
    paged: true,
    columns: [
      { key: 'id', label: 'ID', tdClass: 'mono', title: (r) => r.id, format: shortId },
      { key: 'user_name', label: 'User', format: dash },
      { key: 'user_phone', label: 'Phone', format: dash },
      { key: 'platform', label: 'Platform' },
      { key: 'token', label: 'Token', tdClass: 'mono clip', format: (v) => `${v?.slice(0, 20) ?? ''}…` },
      { key: 'lat', label: 'Lat', format: (v) => (v != null ? Number(v).toFixed(4) : '—') },
      { key: 'lng', label: 'Lng', format: (v) => (v != null ? Number(v).toFixed(4) : '—') },
      { key: 'updated_at', label: 'Updated', tdClass: 'ts', format: fmt },
      { key: 'actions', label: '', tdClass: 'acts' },
    ],
    remove: adminDeleteDevice,
  },
  audit: {
    fetch: adminGetAudit,
    columns: [
      { key: 'created_at', label: 'Time', tdClass: 'ts', format: fmt },
      { key: 'action', label: 'Action' },
      { key: 'entity', label: 'Entity' },
      { key: 'entity_id', label: 'Entity ID', tdClass: 'mono', title: (r) => r.entity_id, format: shortId },
      { key: 'actor', label: 'Actor' },
      { key: 'details', label: 'Details', tdClass: 'clip sub', format: dash },
    ],
  },
};

async function switchTab(tab) {
  activeTab.value = tab;
  activeChart.value = null; // always land on the dashboard card grid
  error.value     = null;
  searchQ.value   = '';
  offset.value    = 0;
  filters.value[tab] = { ...(FILTER_DEFAULTS[tab] || {}) };
  if (tab === 'reports') ensureDisasterOptions();
  await loadTab(tab);
}

// One generic loader for every tab, driven by TAB_CONFIG.
async function loadTab(tab, q = '', off = 0) {
  loading.value = true;
  error.value   = null;
  try {
    const cfg = TAB_CONFIG[tab];
    if (cfg.load) {
      await cfg.load();
    } else {
      const params = {
        ...(cfg.searchable ? { q } : {}),
        ...(cfg.paged ? { limit: PAGE, offset: off } : {}),
        ...filterParams(tab),
      };
      const res = await cfg.fetch(params);
      rows.value = { ...rows.value, [tab]: res.rows };
      if (cfg.paged) totals.value = { ...totals.value, [tab]: res.total };
    }
  } catch (e) {
    error.value = e.message || 'Failed to load data';
  } finally {
    loading.value = false;
  }
}

// Reload whatever the active tab currently shows (overview stats, or the current
// page + filters of a list tab) — driven by the topbar refresh button.
function refreshCurrent() { loadTab(activeTab.value, searchQ.value, offset.value); }

async function doSearch() { offset.value = 0; await loadTab(activeTab.value, searchQ.value, 0); }
async function prevPage() { if (offset.value <= 0) return; offset.value = Math.max(0, offset.value - PAGE); await loadTab(activeTab.value, searchQ.value, offset.value); }
async function nextPage() { const t = totals.value[activeTab.value] ?? 0; if (offset.value + PAGE >= t) return; offset.value += PAGE; await loadTab(activeTab.value, searchQ.value, offset.value); }

const showForm  = ref(false);
const formMode  = ref('create');
const editId    = ref(null);
const formData  = ref({});
const formBusy  = ref(false);
const formError = ref(null);

function openCreate(tab) { formMode.value = 'create'; editId.value = null; formData.value = tab === 'disasters' ? { active: true } : {}; formError.value = null; showForm.value = true; }
function openEdit(tab, row) { formMode.value = 'edit'; editId.value = row.id; formData.value = { ...row }; formError.value = null; showForm.value = true; }
function closeForm() { showForm.value = false; formData.value = {}; formError.value = null; }

async function submitForm() {
  formBusy.value = true; formError.value = null;
  const tab  = activeTab.value;
  const form = TAB_CONFIG[tab]?.form;
  try {
    if (form) {
      if (formMode.value === 'create') await form.create(formData.value);
      else await form.update(editId.value, formData.value);
    }
    closeForm(); await loadTab(tab, searchQ.value, offset.value);
  } catch (e) { formError.value = e.message || 'Save failed'; }
  finally { formBusy.value = false; }
}

const deleteTarget = ref(null);
const deleteBusy   = ref(false);

// Modal focus traps — Tab cycles inside, Esc closes, focus restores on close.
const formModalEl   = ref(null);
const deleteModalEl = ref(null);
useFocusTrap(formModalEl, showForm, closeForm);
useFocusTrap(deleteModalEl, () => !!deleteTarget.value, () => { deleteTarget.value = null; });
function confirmDelete(tab, row) { deleteTarget.value = { tab, row }; }
async function doDelete() {
  if (!deleteTarget.value) return;
  deleteBusy.value = true;
  const { tab, row } = deleteTarget.value;
  try {
    const remove = TAB_CONFIG[tab]?.remove;
    if (remove) await remove(row.id);
    deleteTarget.value = null; await loadTab(tab, searchQ.value, offset.value);
  } catch (e) { error.value = e.message || 'Delete failed'; deleteTarget.value = null; }
  finally { deleteBusy.value = false; }
}

async function setLinkStatus(row, status) {
  try { await adminUpdateLink(row.id, { status }); await loadTab('links', searchQ.value, offset.value); }
  catch (e) { error.value = e.message; }
}

const currentRows = computed(() => rows.value[activeTab.value] ?? []);
const canPage     = computed(() => !!TAB_CONFIG[activeTab.value]?.paged);
const total       = computed(() => totals.value[activeTab.value] ?? currentRows.value.length);

// ── Dashboard view-models (Overview tab) — derived from the /stats payload ──
// The overview is a drill-down: a grid of clickable cards (activeChart === null),
// then ONE domain chart at a time. Each domain uses a different chart form.
const activeChart = ref(null);
function openChart(key) { activeChart.value = key; }
function closeChart()   { activeChart.value = null; }

const DASH_META = [
  { key: 'users',     label: 'Users',     chart: 'donut', kpi: (s) => s.users?.total,      sub: (s) => `${s.users?.citizen ?? 0} citizens` },
  { key: 'reports',   label: 'Reports',   chart: 'hbar',  kpi: (s) => s.reports?.total,    sub: (s) => `${s.reports?.safe ?? 0} marked safe` },
  { key: 'disasters', label: 'Disasters', chart: 'gauge', kpi: (s) => s.disasters?.active, sub: (s) => `of ${s.disasters?.total ?? 0} total` },
  { key: 'links',     label: 'Links',     chart: 'donut', kpi: (s) => s.links?.total,      sub: (s) => `${s.links?.confirmed ?? 0} confirmed` },
  { key: 'devices',   label: 'Devices',   chart: 'hbar',  kpi: (s) => s.devices?.total,    sub: () => 'push tokens' },
  { key: 'audits',    label: 'Audit',     chart: 'vbar',  kpi: (s) => s.audits?.total,     sub: () => 'logged actions' },
];
const dashCards = computed(() => {
  const s = stats.value;
  if (!s) return [];
  return DASH_META.map((m) => ({ key: m.key, label: m.label, chart: m.chart, value: m.kpi(s) ?? 0, sub: m.sub(s) }));
});
const currentCard = computed(() => dashCards.value.find((c) => c.key === activeChart.value) || null);
const CHART_SUBTITLE = { users: 'by role', reports: 'by status', disasters: 'active vs ended', links: 'by status', devices: 'by platform', audits: 'by action' };
const chartTitle = computed(() => CHART_SUBTITLE[activeChart.value] || '');

// Horizontal-bar scaling: tallest = 100%, a non-zero count always gets a sliver.
function toBars(list) {
  const max = Math.max(1, ...list.map((r) => r.n));
  return list.map((r) => ({ ...r, pct: r.n > 0 ? Math.max(4, Math.round((r.n / max) * 100)) : 0 }));
}
// Reports by status — the app's vivid status colours (shipped with text labels).
const reportBars = computed(() => toBars([
  { key: 'safe',      label: 'Safe',      n: stats.value?.reports?.safe      ?? 0, color: STATUS_COLOR_VIVID.safe },
  { key: 'injured',   label: 'Injured',   n: stats.value?.reports?.injured   ?? 0, color: STATUS_COLOR_VIVID.injured },
  { key: 'need_help', label: 'Need Help', n: stats.value?.reports?.need_help ?? 0, color: STATUS_COLOR_VIVID.need_help },
  { key: 'missing',   label: 'Missing',   n: stats.value?.reports?.missing   ?? 0, color: STATUS_COLOR_VIVID.missing },
]));
// Devices by platform — single charcoal hue.
const deviceBars = computed(() => toBars([
  { key: 'ios',     label: 'iOS',     n: stats.value?.devices?.ios     ?? 0 },
  { key: 'android', label: 'Android', n: stats.value?.devices?.android ?? 0 },
  { key: 'other',   label: 'Other',   n: stats.value?.devices?.other   ?? 0 },
]));
// Audit events by action — vertical bars (a different form from the h-bars).
const auditBars = computed(() => {
  const a = stats.value?.audits || {};
  const list = [
    { key: 'create', label: 'Create', n: a.create ?? 0 },
    { key: 'update', label: 'Update', n: a.update ?? 0 },
    { key: 'delete', label: 'Delete', n: a.delete ?? 0 },
    { key: 'login',  label: 'Login',  n: a.login  ?? 0 },
  ];
  const max = Math.max(1, ...list.map((x) => x.n));
  return list.map((x) => ({ ...x, h: x.n > 0 ? Math.max(6, Math.round((x.n / max) * 100)) : 0 }));
});
// Donut via the r=15.9155 (circumference≈100) trick: dash = "pct rest",
// offset = 25 - cumulative puts the first slice at 12 o'clock, going clockwise.
function donutSegments(items) {
  const total = items.reduce((s, x) => s + (x.n || 0), 0);
  let acc = 0;
  return items.map((it) => {
    const pct = total > 0 ? (it.n / total) * 100 : 0;
    const seg = { ...it, pct, dash: `${pct} ${100 - pct}`, offset: 25 - acc };
    acc += pct;
    return seg;
  });
}
const roleDonut = computed(() => donutSegments([
  { key: 'citizen',     label: 'Citizen',     n: stats.value?.users?.citizen     ?? 0, color: '#26262b' },
  { key: 'volunteer',   label: 'Volunteer',   n: stats.value?.users?.volunteer   ?? 0, color: '#55585f' },
  { key: 'government',  label: 'Government',   n: stats.value?.users?.government  ?? 0, color: '#8a8b93' },
  { key: 'super_admin', label: 'Super Admin', n: stats.value?.users?.super_admin ?? 0, color: '#c4c4ca' },
]));
const linkDonut = computed(() => {
  const l = stats.value?.links || {};
  const other = Math.max(0, (l.total ?? 0) - (l.confirmed ?? 0) - (l.pending ?? 0));
  return donutSegments([
    { key: 'confirmed', label: 'Confirmed', n: l.confirmed ?? 0, color: '#26262b' },
    { key: 'pending',   label: 'Pending',   n: l.pending ?? 0,   color: '#9a9ba3' },
    { key: 'other',     label: 'Other',     n: other,            color: '#d8d8dd' },
  ]);
});
const disasterRatio = computed(() => {
  const d = stats.value?.disasters || {};
  const total = d.total ?? 0, active = d.active ?? 0;
  return { total, active, ended: Math.max(0, total - active), pct: total > 0 ? Math.round((active / total) * 100) : 0 };
});

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
  <LoginPanel v-if="!adminToken" subtitle="Administration Console" :error="loginError" :busy="loginBusy" @submit="login">
    <label class="field-label" for="admin-login-phone">Phone</label>
    <input id="admin-login-phone" v-model="loginPhone" class="login-input" type="tel" placeholder="+852 9xxx xxxx" autocomplete="username" required />
    <label class="field-label" for="admin-login-pass">Password</label>
    <input id="admin-login-pass" v-model="loginPass" class="login-input" type="password" placeholder="••••••••" autocomplete="current-password" required />
  </LoginPanel>

  <!-- DASHBOARD -->
  <div v-else class="shell">
    <header class="topbar">
      <div class="topbar-l">
        <span class="topbar-name">Report Safe</span>
        <span class="topbar-div">/</span>
        <span class="topbar-sub">Admin Console</span>
      </div>
      <div class="topbar-r">
        <span class="topbar-ts">{{ nowStr }}</span>
        <span class="topbar-user">{{ adminUser?.name || adminUser?.phone }}</span>
        <button class="topbar-refresh" @click="refreshCurrent" :disabled="loading" title="Refresh" aria-label="Refresh current view"><AppIcon name="refresh" :size="16" /></button>
        <button class="topbar-logout" @click="logout">Sign out</button>
      </div>
    </header>

    <div class="body">
      <nav class="sidebar">
        <button v-for="tab in TABS" :key="tab.id" class="nav-btn" :class="{ on: activeTab === tab.id }" @click="switchTab(tab.id)">{{ tab.label }}</button>
      </nav>

      <main class="content">
        <div v-if="error" class="err-bar" role="alert">{{ error }} <button aria-label="Dismiss error" @click="error = null">✕</button></div>

        <!-- OVERVIEW — drill-down dashboard: card grid → one domain chart -->
        <section v-if="activeTab === 'overview'">
          <div class="toolbar">
            <h2 v-if="!activeChart" class="page-title">System Overview</h2>
            <h2 v-else class="page-title crumb">
              <button class="crumb-back" @click="closeChart"><AppIcon name="chevron-down" :size="15" class="crumb-ico" /> Dashboard</button>
              <span class="crumb-sep">/</span>{{ currentCard?.label }}
            </h2>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!stats" class="state-msg">No data available.</div>

          <!-- GRID: clickable domain cards -->
          <div v-else-if="!activeChart" class="kpi-grid">
            <button v-for="c in dashCards" :key="c.key" class="kpi-card kpi-click" @click="openChart(c.key)">
              <div class="kpi-label">{{ c.label }}</div>
              <div class="kpi-value">{{ c.value }}</div>
              <div class="kpi-sub">{{ c.sub }}</div>
              <span class="kpi-cta">View chart <AppIcon name="chevron-down" :size="13" class="cta-ico" /></span>
            </button>
          </div>

          <!-- DETAIL: the selected domain's chart -->
          <div v-else class="dash-card chart-stage">
            <div class="dash-head"><h3>{{ currentCard?.label }} <span class="dash-sub">· {{ chartTitle }}</span></h3><span class="dash-total">{{ currentCard?.value }} total</span></div>

            <!-- Reports → horizontal bars in status colours -->
            <div v-if="activeChart === 'reports'" class="bars bars-lg">
              <div class="bar-row" v-for="b in reportBars" :key="b.key" :title="`${b.label}: ${b.n}`">
                <span class="bar-cat">{{ b.label }}</span>
                <div class="bar-track"><div class="bar-fill" :style="{ width: b.pct + '%', background: b.color }"></div></div>
                <span class="bar-val">{{ b.n }}</span>
              </div>
            </div>

            <!-- Devices → horizontal bars (charcoal) -->
            <div v-else-if="activeChart === 'devices'" class="bars bars-lg">
              <div class="bar-row" v-for="b in deviceBars" :key="b.key" :title="`${b.label}: ${b.n}`">
                <span class="bar-cat">{{ b.label }}</span>
                <div class="bar-track"><div class="bar-fill charcoal" :style="{ width: b.pct + '%' }"></div></div>
                <span class="bar-val">{{ b.n }}</span>
              </div>
            </div>

            <!-- Audit → vertical bars -->
            <div v-else-if="activeChart === 'audits'" class="vbars">
              <div class="vbar-col" v-for="b in auditBars" :key="b.key" :title="`${b.label}: ${b.n}`">
                <span class="vbar-val">{{ b.n }}</span>
                <div class="vbar-track"><div class="vbar-fill" :style="{ height: b.h + '%' }"></div></div>
                <span class="vbar-cat">{{ b.label }}</span>
              </div>
            </div>

            <!-- Users / Links → donut · Disasters → gauge -->
            <div v-else class="donut-wrap">
              <svg class="donut-svg" viewBox="0 0 42 42" role="img" :aria-label="`${currentCard?.label} ${chartTitle}`">
                <circle class="donut-track" cx="21" cy="21" r="15.9155" fill="none" stroke="#f0f0f2" stroke-width="4.5" />
                <circle v-if="activeChart === 'disasters'" class="donut-seg" cx="21" cy="21" r="15.9155" fill="none" stroke="#26262b" stroke-width="4.5" :stroke-dasharray="`${disasterRatio.pct} ${100 - disasterRatio.pct}`" stroke-dashoffset="25" />
                <circle v-else v-for="s in (activeChart === 'users' ? roleDonut : linkDonut)" :key="s.key" class="donut-seg" cx="21" cy="21" r="15.9155" fill="none" :stroke="s.color" stroke-width="4.5" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" />
                <text x="21" y="20.5" class="donut-c-n">{{ activeChart === 'disasters' ? disasterRatio.active : currentCard?.value }}</text>
                <text x="21" y="25.6" class="donut-c-l">{{ activeChart === 'disasters' ? 'active' : 'total' }}</text>
              </svg>
              <div class="donut-legend">
                <template v-if="activeChart === 'disasters'">
                  <div class="dleg-row"><span class="dleg-dot" style="background:#26262b"></span><span class="dleg-label">Active</span><span class="dleg-val">{{ disasterRatio.active }} · {{ disasterRatio.pct }}%</span></div>
                  <div class="dleg-row"><span class="dleg-dot" style="background:#e4e4e8"></span><span class="dleg-label">Ended</span><span class="dleg-val">{{ disasterRatio.ended }}</span></div>
                </template>
                <div v-else v-for="s in (activeChart === 'users' ? roleDonut : linkDonut)" :key="s.key" class="dleg-row">
                  <span class="dleg-dot" :style="{ background: s.color }"></span>
                  <span class="dleg-label">{{ s.label }}</span>
                  <span class="dleg-val">{{ s.n }} · {{ Math.round(s.pct) }}%</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- USERS -->
        <section v-if="activeTab === 'users'">
          <div class="toolbar"><h2 class="page-title">Users</h2>
            <div class="toolbar-r">
              <form @submit.prevent="doSearch" class="search-bar"><input v-model="searchQ" class="inp" placeholder="Search name / phone…" aria-label="Search users by name or phone" /><button class="btn" type="submit"><AppIcon name="search" :size="15" /> Search</button></form>
              <button class="btn btn-dark" @click="openCreate('users')"><AppIcon name="add" :size="16" /> New user</button>
            </div></div>
          <div class="filter-row">
            <select v-model="filters.users.role" class="flt" @change="applyFilters('users')"><option value="">Role: all</option><option value="citizen">citizen</option><option value="volunteer">volunteer</option><option value="government">government</option><option value="super_admin">super_admin</option></select>
            <select v-model="filters.users.user_type" class="flt" @change="applyFilters('users')"><option value="">Type: all</option><option value="mobile">mobile</option><option value="web">web</option></select>
            <select v-model="filters.users.consent" class="flt" @change="applyFilters('users')"><option value="">Consent: any</option><option value="true">given</option><option value="false">none</option></select>
            <select v-model="filters.users.has_email" class="flt" @change="applyFilters('users')"><option value="">Email: any</option><option value="true">has</option><option value="false">none</option></select>
            <button v-if="hasFilters('users')" class="flt-clear" @click="clearFilters('users')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.users.columns" :rows="currentRows">
            <template #cell-actions="{ row }"><button class="btn btn-xs" @click="openEdit('users', row)">Edit</button><button class="btn btn-xs" @click="confirmDelete('users', row)">Del</button></template>
          </DataTable>
        </section>

        <!-- REPORTS -->
        <section v-if="activeTab === 'reports'">
          <div class="toolbar"><h2 class="page-title">Status Reports</h2>
            <div class="toolbar-r">
              <form @submit.prevent="doSearch" class="search-bar"><input v-model="searchQ" class="inp" placeholder="Search name / phone…" aria-label="Search reports by name or phone" /><button class="btn" type="submit"><AppIcon name="search" :size="15" /> Search</button></form>
              <button class="btn btn-dark" @click="openCreate('reports')"><AppIcon name="add" :size="16" /> New report</button>
            </div></div>
          <div class="filter-row">
            <select v-model="filters.reports.status" class="flt" @change="applyFilters('reports')"><option value="">Status: all</option><option v-for="s in REPORT_STATUSES" :key="s" :value="s">{{ s.replace(/_/g, ' ') }}</option></select>
            <select v-model="filters.reports.reported_by" class="flt" @change="applyFilters('reports')"><option value="">Source: all</option><option value="self">self</option><option value="family">family</option></select>
            <select v-model="filters.reports.user_type" class="flt" @change="applyFilters('reports')"><option value="">Origin: all</option><option value="mobile">mobile</option><option value="web">web</option></select>
            <select v-model="filters.reports.disaster_id" class="flt" @change="applyFilters('reports')"><option value="">Disaster: all</option><option value="__any__">in zone</option><option value="__none__">no zone</option><option v-for="d in disasterOptions" :key="d.id" :value="d.id">{{ d.type }} — {{ shortId(d.id) }}</option></select>
            <button v-if="hasFilters('reports')" class="flt-clear" @click="clearFilters('reports')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.reports.columns" :rows="currentRows">
            <template #cell-name="{ row }">{{ row.user_name || row.name }}<span v-if="row.user_name && row.name && row.user_name !== row.name" class="sub"> ({{ row.name }})</span></template>
            <template #cell-status="{ row }"><StatusBadge :status="row.status" :bare="true" :icon="false" /></template>
            <template #cell-linked="{ row }">{{ row.user_name || '—' }}<br v-if="row.user_name" /><span class="sub">{{ row.user_phone || '' }}</span></template>
            <template #cell-actions="{ row }"><button class="btn btn-xs" @click="openEdit('reports', row)">Edit</button><button class="btn btn-xs" @click="confirmDelete('reports', row)">Del</button></template>
          </DataTable>
        </section>

        <!-- DISASTERS -->
        <section v-if="activeTab === 'disasters'">
          <div class="toolbar"><h2 class="page-title">Disasters</h2>
            <div class="toolbar-r"><button class="btn btn-dark" @click="openCreate('disasters')"><AppIcon name="add" :size="16" /> New disaster</button></div></div>
          <div class="filter-row">
            <select v-model="filters.disasters.active" class="flt" @change="applyFilters('disasters')"><option value="">Status: all</option><option value="true">active</option><option value="false">ended</option></select>
            <select v-model="filters.disasters.type" class="flt" @change="applyFilters('disasters')"><option value="">Type: all</option><option v-for="t in DISASTER_TYPES" :key="t" :value="t">{{ t }}</option></select>
            <button v-if="hasFilters('disasters')" class="flt-clear" @click="clearFilters('disasters')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.disasters.columns" :rows="currentRows">
            <template #cell-actions="{ row }"><button class="btn btn-xs" @click="openEdit('disasters', row)">Edit</button><button class="btn btn-xs" @click="confirmDelete('disasters', row)">Del</button></template>
          </DataTable>
        </section>

        <!-- LINKS -->
        <section v-if="activeTab === 'links'">
          <div class="toolbar"><h2 class="page-title">Account Links</h2>
            <div class="toolbar-r"><form @submit.prevent="doSearch" class="search-bar"><input v-model="searchQ" class="inp" placeholder="Search name / phone…" aria-label="Search links by name or phone" /><button class="btn" type="submit"><AppIcon name="search" :size="15" /> Search</button></form></div></div>
          <div class="filter-row">
            <select v-model="filters.links.status" class="flt" @change="applyFilters('links')"><option value="">Status: all</option><option value="confirmed">confirmed</option><option value="pending">pending</option><option value="blocked">blocked</option></select>
            <button v-if="hasFilters('links')" class="flt-clear" @click="clearFilters('links')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.links.columns" :rows="currentRows">
            <template #cell-status="{ row }"><select class="flt inline" :value="row.status" aria-label="Link status" @change="setLinkStatus(row, $event.target.value)"><option value="pending">pending</option><option value="confirmed">confirmed</option><option value="blocked">blocked</option></select></template>
            <template #cell-actions="{ row }"><button class="btn btn-xs" @click="confirmDelete('links', row)">Del</button></template>
          </DataTable>
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
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.devices.columns" :rows="currentRows">
            <template #cell-actions="{ row }"><button class="btn btn-xs" @click="confirmDelete('devices', row)">Del</button></template>
          </DataTable>
        </section>

        <!-- AUDIT -->
        <section v-if="activeTab === 'audit'">
          <div class="toolbar"><h2 class="page-title">Audit Log</h2><button class="btn" @click="loadTab('audit', '', 0)"><AppIcon name="refresh" :size="15" /> Refresh</button></div>
          <div class="filter-row">
            <select v-model="filters.audit.action" class="flt" @change="applyFilters('audit')"><option value="">Action: all</option><option value="create">create</option><option value="update">update</option><option value="delete">delete</option><option value="login">login</option></select>
            <select v-model="filters.audit.entity" class="flt" @change="applyFilters('audit')"><option value="">Entity: all</option><option value="users">users</option><option value="reports">reports</option><option value="disasters">disasters</option><option value="account_links">links</option><option value="device_push_tokens">devices</option></select>
            <button v-if="hasFilters('audit')" class="flt-clear" @click="clearFilters('audit')">Clear</button>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.audit.columns" :rows="currentRows" />
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
      <div ref="formModalEl" class="modal" role="dialog" aria-modal="true" aria-labelledby="admin-form-title" tabindex="-1">
        <div class="modal-hd"><h3 id="admin-form-title">{{ formMode === 'create' ? 'New' : 'Edit' }} {{ activeTab.replace(/s$/, '') }}</h3><button class="modal-x" aria-label="Close" @click="closeForm">✕</button></div>
        <form @submit.prevent="submitForm" class="modal-body">
          <template v-for="field in TAB_CONFIG[activeTab]?.form?.fields || []" :key="field.key">
            <label :for="`fld-${field.key}`">{{ field.label }} <span v-if="field.required" class="req">*</span><span v-if="field.note" class="sub"> — {{ field.note }}</span></label>
            <textarea v-if="field.type === 'textarea'" :id="`fld-${field.key}`" v-model="formData[field.key]" class="inp" rows="3" />
            <select v-else-if="field.type === 'select'" :id="`fld-${field.key}`" v-model="formData[field.key]" class="inp"><option value="">—</option><option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option></select>
            <label v-else-if="field.type === 'checkbox'" class="chk"><input :id="`fld-${field.key}`" type="checkbox" v-model="formData[field.key]" /> {{ field.label }}</label>
            <input v-else :id="`fld-${field.key}`" v-model="formData[field.key]" class="inp" :type="field.type || 'text'" :required="field.required && formMode === 'create'" />
          </template>
          <div v-if="formError" class="form-err" role="alert">{{ formError }}</div>
          <div class="modal-acts">
            <button type="button" class="btn" @click="closeForm">Cancel</button>
            <button type="submit" class="btn btn-dark" :disabled="formBusy">{{ formBusy ? 'Saving…' : (formMode === 'create' ? 'Create' : 'Save') }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- DELETE CONFIRM -->
    <div v-if="deleteTarget" class="overlay" @click.self="deleteTarget = null">
      <div ref="deleteModalEl" class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="admin-delete-title" tabindex="-1">
        <div class="modal-hd"><h3 id="admin-delete-title">Confirm deletion</h3><button class="modal-x" aria-label="Close" @click="deleteTarget = null">✕</button></div>
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

/* Neutral grey/white "modern console" — airy white cards on a light canvas,
   hairline borders, one charcoal primary. All values are scoped-local so the
   citizen design tokens stay untouched. */

/* ── Login (fields slotted into the shared LoginPanel) ─── */
.field-label { font-size:12px; font-weight:600; color:#5b5c63; margin-top:10px; margin-bottom:5px; }
.login-input { padding:10px 12px; border:1px solid #dedee2; font-size:14px; color:#1e1e22; background:#fff; width:100%; box-sizing:border-box; font-family:inherit; border-radius:9px; }
.login-input:focus { border-color:#26262b; box-shadow:0 0 0 3px rgba(38,38,43,0.08); outline:none; }

/* ── Shell ──────────────────────────────────────────────── */
.shell { display:flex; flex-direction:column; height:100vh; background:#f5f5f6; font-family:var(--font-ui); font-size:14px; color:#1e1e22; overflow:hidden; }
.body { display:flex; flex:1; min-height:0; }

/* ── Top Bar ───────────────────────────────────────────── */
.topbar { display:flex; align-items:center; justify-content:space-between; height:52px; padding:0 18px; background:#ebecef; color:#5b5c63; border-bottom:1px solid #d9dbe0; flex-shrink:0; }
.topbar-l { display:flex; align-items:center; gap:10px; }
.topbar-crest { width:28px; height:28px; background:#26262b; display:flex; align-items:center; justify-content:center; font-size:15px; color:#fff; border-radius:8px; }
.topbar-name { font-size:15px; font-weight:700; color:#1e1e22; letter-spacing:-0.01em; }
.topbar-div { color:#d3d3d7; }
.topbar-sub { font-size:12.5px; color:#8a8b93; font-weight:500; }
.topbar-r { display:flex; align-items:center; gap:14px; }
.topbar-ts { font-size:12px; color:#9a9ba3; font-family:var(--font-mono); }
.topbar-user { font-size:13px; color:#5b5c63; font-weight:500; }
.topbar-refresh { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; padding:0; background:#fff; border:1px solid #dedee2; color:#5b5c63; cursor:pointer; font-family:inherit; border-radius:8px; }
.topbar-refresh:hover:not(:disabled) { border-color:#c4c4ca; color:#1e1e22; background:#f5f5f6; }
.topbar-refresh:disabled { opacity:.5; cursor:not-allowed; }
.topbar-logout { padding:6px 12px; background:#fff; border:1px solid #dedee2; color:#5b5c63; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; border-radius:8px; height:auto; }
.topbar-logout:hover { border-color:#c4c4ca; color:#1e1e22; background:#f5f5f6; }

/* ── Sidebar ───────────────────────────────────────────── */
.sidebar { width:176px; background:#ebecef; border-right:1px solid #d9dbe0; display:flex; flex-direction:column; padding:10px; gap:3px; flex-shrink:0; overflow-y:auto; }
.nav-btn { display:block; padding:9px 12px; background:transparent; border:none; color:#5b5c63; cursor:pointer; text-align:left; font-size:13.5px; font-weight:500; font-family:inherit; width:100%; border-radius:9px; height:auto; }
.nav-btn:hover { color:#1e1e22; background:#e2e3e7; }
.nav-btn.on { color:#fff; font-weight:600; background:#26262b; }

/* ── Content ───────────────────────────────────────────── */
.content { flex:1; overflow:auto; padding:22px 26px; display:flex; flex-direction:column; gap:16px; background:#f5f5f6; }

/* ── Typography / toolbar ──────────────────────────────── */
.page-title { font-size:19px; font-weight:700; color:#1e1e22; margin:0; letter-spacing:-0.01em; }
.toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.toolbar-r { display:flex; align-items:center; gap:10px; }
.search-bar { display:flex; }
.search-bar .inp { width:220px; height:38px; border-top-right-radius:0; border-bottom-right-radius:0; border-right:none; }
.search-bar .btn { border-top-left-radius:0; border-bottom-left-radius:0; }

/* ── Filter card ───────────────────────────────────────── */
.filter-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; background:#fff; border:1px solid #e9e9ec; border-radius:12px; padding:12px 14px; box-shadow:0 1px 2px rgba(0,0,0,0.03); }
.flt { width:auto; min-width:120px; padding:8px 12px; border:1px solid #dedee2; background:#fff; font-size:13px; color:#3a3a41; font-family:inherit; cursor:pointer; border-radius:8px; height:auto; }
.flt:focus { border-color:#26262b; box-shadow:0 0 0 3px rgba(38,38,43,0.07); outline:none; }
.flt.inline { padding:5px 8px; font-size:12px; }
.flt-clear { padding:8px 14px; font-size:13px; font-weight:600; background:#fff; border:1px solid #dedee2; color:#5b5c63; cursor:pointer; font-family:inherit; border-radius:8px; margin-left:auto; }
.flt-clear:hover { background:#f3f3f5; color:#1e1e22; border-color:#c4c4ca; }

/* ── Inputs ────────────────────────────────────────────── */
.inp { padding:9px 12px; border:1px solid #dedee2; font-size:14px; color:#1e1e22; background:#fff; width:100%; font-family:inherit; border-radius:8px; }
.inp:focus { border-color:#26262b; box-shadow:0 0 0 3px rgba(38,38,43,0.07); outline:none; }

/* ── Buttons ───────────────────────────────────────────── */
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:38px; padding:0 15px; border:1px solid #dedee2; background:#fff; color:#3a3a41; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; border-radius:8px; white-space:nowrap; }
.btn:hover:not(:disabled) { background:#f3f3f5; border-color:#c4c4ca; color:#1e1e22; }
.btn:active:not(:disabled) { background:#ebebee; }
.btn:disabled { opacity:.4; cursor:not-allowed; }
.btn-dark { background:#26262b; color:#fff; border-color:#26262b; }
.btn-dark:hover:not(:disabled) { background:#131316; border-color:#131316; color:#fff; }
.btn-dark:active:not(:disabled) { background:#000; }
.btn-xs { height:30px; padding:0 11px; font-size:12px; border-radius:7px; }

/* ── Table cell content (rendered into DataTable slots) ── */
.sub { color:#9a9ba3; font-size:12px; }

/* ── Dashboard (Overview) — drill-down: clickable cards → one domain chart ── */
.kpi-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); gap:14px; }
.kpi-card { background:#fff; border:1px solid #e9e9ec; border-radius:14px; padding:16px 18px; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
.kpi-label { font-size:11.5px; font-weight:600; color:#9a9ba3; text-transform:uppercase; letter-spacing:0.03em; }
.kpi-value { font-size:32px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); line-height:1.1; margin-top:8px; }
.kpi-sub { font-size:12px; color:#8a8b93; margin-top:4px; }
/* Clickable card (button reset) — the drill-down entry point */
.kpi-click { display:block; width:100%; height:auto; text-align:left; cursor:pointer; font-family:inherit; }
.kpi-click:hover { border-color:#c4c4ca; box-shadow:0 3px 10px rgba(0,0,0,0.07); }
.kpi-click:focus-visible { outline:2px solid #26262b; outline-offset:2px; }
.kpi-cta { display:inline-flex; align-items:center; gap:3px; margin-top:12px; font-size:11.5px; font-weight:700; color:#26262b; opacity:0; }
.kpi-click:hover .kpi-cta, .kpi-click:focus-visible .kpi-cta { opacity:1; }
.cta-ico { transform:rotate(-90deg); }

/* Breadcrumb header while a chart is open */
.crumb { display:flex; align-items:center; gap:8px; }
.crumb-back { display:inline-flex; align-items:center; gap:3px; height:auto; padding:0; background:none; border:none; cursor:pointer; font-family:inherit; font-size:19px; font-weight:700; color:#9a9ba3; letter-spacing:-0.01em; }
.crumb-back:hover { color:#1e1e22; }
.crumb-ico { transform:rotate(90deg); }
.crumb-sep { color:#c4c4ca; }

/* Detail card holding one chart */
.dash-card { background:#fff; border:1px solid #e9e9ec; border-radius:14px; padding:18px 20px; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
.chart-stage { max-width:640px; }
.dash-head { display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-bottom:20px; }
.dash-head h3 { margin:0; font-size:14px; font-weight:700; color:#1e1e22; }
.dash-sub { color:#9a9ba3; font-weight:500; }
.dash-total { font-size:12px; color:#9a9ba3; font-family:var(--font-mono); white-space:nowrap; }

/* Horizontal bars — category | recessive track+fill | mono value */
.bars { display:flex; flex-direction:column; gap:12px; }
.bars-lg { gap:16px; }
.bar-row { display:grid; grid-template-columns:96px 1fr 34px; align-items:center; gap:10px; }
.bars-lg .bar-track { height:14px; }
.bar-cat { font-size:12.5px; color:#5b5c63; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bar-track { height:10px; background:#f0f0f2; border-radius:999px; overflow:hidden; }
.bar-fill { height:100%; border-radius:999px; min-width:0; background:#26262b; }
.bar-fill.charcoal { background:#26262b; }
.bar-row:hover .bar-fill { filter:brightness(0.9); }
.bar-val { font-size:13px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); text-align:right; }

/* Vertical bars (Audit by action) */
.vbars { display:flex; align-items:flex-end; gap:22px; height:220px; padding:8px 4px 0; }
.vbar-col { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:8px; height:100%; justify-content:flex-end; }
.vbar-val { font-size:13px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); }
.vbar-track { width:46px; max-width:70%; flex:1; min-height:0; display:flex; align-items:flex-end; background:#f0f0f2; border-radius:8px 8px 0 0; overflow:hidden; }
.vbar-fill { width:100%; background:#26262b; border-radius:8px 8px 0 0; min-height:0; }
.vbar-col:hover .vbar-fill { filter:brightness(0.9); }
.vbar-cat { font-size:12px; color:#5b5c63; font-weight:500; }

/* Donut / gauge (Users, Links, Disasters) */
.donut-wrap { display:flex; align-items:center; gap:30px; flex-wrap:wrap; }
.donut-svg { width:170px; height:170px; flex-shrink:0; }
.donut-c-n { fill:#1e1e22; font-family:var(--font-mono); font-weight:700; font-size:7.5px; text-anchor:middle; dominant-baseline:central; }
.donut-c-l { fill:#9a9ba3; font-size:2.6px; text-anchor:middle; dominant-baseline:central; text-transform:uppercase; letter-spacing:0.08em; }
.donut-legend { display:flex; flex-direction:column; gap:10px; min-width:180px; }
.dleg-row { display:grid; grid-template-columns:14px 1fr auto; align-items:center; gap:9px; font-size:13px; }
.dleg-dot { width:11px; height:11px; border-radius:3px; }
.dleg-label { color:#5b5c63; font-weight:500; }
.dleg-val { color:#1e1e22; font-weight:700; font-family:var(--font-mono); font-size:12.5px; }

/* ── Pagination ────────────────────────────────────────── */
.pager { display:flex; align-items:center; gap:8px; padding-top:2px; }
.pager-info { font-size:13px; color:#9a9ba3; margin-right:auto; }

/* ── States ────────────────────────────────────────────── */
.err-bar { display:flex; align-items:center; gap:8px; padding:11px 14px; background:#fff; border:1px solid #e9e9ec; border-left:3px solid #26262b; color:#1e1e22; font-size:13px; border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
.err-bar button { margin-left:auto; background:none; border:none; cursor:pointer; color:#9a9ba3; font-size:14px; height:auto; padding:0; }
.form-err { padding:9px 12px; background:#f7f7f8; border:1px solid #dedee2; border-left:3px solid #26262b; font-size:13px; color:#1e1e22; border-radius:8px; }
.state-msg { color:#9a9ba3; padding:28px 4px; font-size:14px; text-align:center; background:#fff; border:1px solid #e9e9ec; border-radius:12px; }

/* ── Modal ──────────────────────────────────────────────── */
.overlay { position:fixed; inset:0; background:rgba(20,20,24,.42); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; }
.modal { background:#fff; width:460px; max-width:96vw; max-height:90vh; overflow-y:auto; border:1px solid #e3e3e7; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.22); }
.modal-sm { width:360px; }
.modal-hd { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #eeeef0; background:#fff; position:sticky; top:0; }
.modal-hd h3 { margin:0; font-size:15px; font-weight:700; color:#1e1e22; text-transform:capitalize; }
.modal-x { background:none; border:none; font-size:16px; cursor:pointer; color:#9a9ba3; height:auto; padding:0; }
.modal-x:hover { color:#1e1e22; }
.modal-body { display:flex; flex-direction:column; gap:6px; padding:18px 20px; }
.modal-body label { font-size:12.5px; font-weight:600; color:#5b5c63; margin-top:6px; }
.modal-acts { display:flex; gap:10px; justify-content:flex-end; margin-top:14px; padding-top:16px; border-top:1px solid #eeeef0; }
.modal-msg { padding:16px 20px; color:#5b5c63; line-height:1.6; margin:0; font-size:14px; }
.req { color:#9a9ba3; }
.chk { display:flex; align-items:center; gap:8px; font-size:13px; color:#1e1e22; cursor:pointer; text-transform:none; }
</style>
