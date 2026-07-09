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
import AdminChart from '../components/AdminChart.vue';
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
function applyFilters(tab) { offset.value = 0; loadTab(tab, searchQ.value, 0); }
// The filter-bar "Clear" resets BOTH the search box and the filters.
function clearFilters(tab) { searchQ.value = ''; filters.value[tab] = { ...(FILTER_DEFAULTS[tab] || {}) }; offset.value = 0; loadTab(tab, '', 0); }

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
  overview: {}, // dashboard — no rows to fetch; loadTab() pulls the summary stats

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

async function loadStats() {
  try { stats.value = await adminGetStats(); } catch { /* keep prior stats on a transient failure */ }
}
// One generic loader for every tab: always refreshes the top-of-tab summary
// counters (loadStats) alongside the tab's own rows (when the tab has a fetch).
async function loadTab(tab, q = '', off = 0) {
  loading.value = true;
  error.value   = null;
  try {
    const cfg = TAB_CONFIG[tab];
    const jobs = [loadStats()];
    if (cfg.fetch) {
      const params = {
        ...(cfg.searchable ? { q } : {}),
        ...(cfg.paged ? { limit: PAGE, offset: off } : {}),
        ...filterParams(tab),
      };
      jobs.push(cfg.fetch(params).then((res) => {
        rows.value = { ...rows.value, [tab]: res.rows };
        if (cfg.paged) totals.value = { ...totals.value, [tab]: res.total };
      }));
    }
    await Promise.all(jobs);
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

// ── Dashboard view-models (Overview) — every chart is shown at once; clicking a
// card "pops" that chart into a modal. activeChart holds the popped domain key. ──
const activeChart = ref(null);
function openChart(key) { activeChart.value = key; }
function closeChart()   { activeChart.value = null; }
const CHART_SUB = { users: 'by role', reports: 'by status', disasters: 'active vs ended', links: 'by status', devices: 'by platform', audits: 'by action' };

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

// Assemble the six chart specs (one per domain) consumed by <AdminChart>.
const legendFromSegments = (segs) => segs.map((s) => ({ label: s.label, val: `${s.n} · ${Math.round(s.pct)}%`, color: s.color }));
const dashCharts = computed(() => {
  const s = stats.value;
  if (!s) return [];
  const d = disasterRatio.value;
  return [
    { key: 'users',     label: 'Users',     value: s.users?.total ?? 0,   type: 'donut', centerN: s.users?.total ?? 0, centerL: 'total',  segments: roleDonut.value, legend: legendFromSegments(roleDonut.value) },
    { key: 'reports',   label: 'Reports',   value: s.reports?.total ?? 0, type: 'hbar',  bars: reportBars.value },
    { key: 'disasters', label: 'Disasters', value: d.active,              type: 'gauge', centerN: d.active, centerL: 'active', pct: d.pct, legend: [{ label: 'Active', val: `${d.active} · ${d.pct}%`, color: '#26262b' }, { label: 'Ended', val: d.ended, color: '#e4e4e8' }] },
    { key: 'links',     label: 'Links',     value: s.links?.total ?? 0,   type: 'donut', centerN: s.links?.total ?? 0, centerL: 'total',  segments: linkDonut.value, legend: legendFromSegments(linkDonut.value) },
    { key: 'devices',   label: 'Devices',   value: s.devices?.total ?? 0, type: 'hbar',  bars: deviceBars.value },
    { key: 'audits',    label: 'Audit',     value: s.audits?.total ?? 0,  type: 'vbar',  bars: auditBars.value },
  ];
});
const currentChart = computed(() => dashCharts.value.find((c) => c.key === activeChart.value) || null);
const chartModalEl = ref(null);
useFocusTrap(chartModalEl, () => !!activeChart.value, closeChart);

// Top-of-tab summary counters (a compact "dash" on every data tab), from /stats.
const TAB_STAT_DEFS = {
  users:     (s) => [{ label: 'Total Users', value: s.users?.total }, { label: 'Citizens', value: s.users?.citizen }, { label: 'Volunteers', value: s.users?.volunteer }, { label: 'Government', value: s.users?.government }],
  reports:   (s) => [{ label: 'Total Reports', value: s.reports?.total }, { label: 'Safe', value: s.reports?.safe }, { label: 'Injured', value: s.reports?.injured }, { label: 'Missing', value: s.reports?.missing }],
  disasters: (s) => [{ label: 'Total', value: s.disasters?.total }, { label: 'Active', value: s.disasters?.active }, { label: 'Ended', value: (s.disasters?.total ?? 0) - (s.disasters?.active ?? 0) }],
  links:     (s) => [{ label: 'Total Links', value: s.links?.total }, { label: 'Confirmed', value: s.links?.confirmed }, { label: 'Pending', value: s.links?.pending }],
  devices:   (s) => [{ label: 'Total Devices', value: s.devices?.total }, { label: 'iOS', value: s.devices?.ios }, { label: 'Android', value: s.devices?.android }, { label: 'Other', value: s.devices?.other }],
  audit:     (s) => [{ label: 'Total Events', value: s.audits?.total }, { label: 'Create', value: s.audits?.create }, { label: 'Update', value: s.audits?.update }, { label: 'Delete', value: s.audits?.delete }, { label: 'Login', value: s.audits?.login }],
};
const statCards = computed(() => {
  const s = stats.value, def = TAB_STAT_DEFS[activeTab.value];
  if (!s || !def) return [];
  return def(s).map((c) => ({ label: c.label, value: c.value ?? 0 }));
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
  } else if (adminToken.value) {
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
    <div class="body">
      <nav class="sidebar">
        <div class="sb-top">
          <div class="sb-brand"><span class="sb-name">Report Safe</span><span class="sb-sub">Admin Console</span></div>
        </div>
        <div class="sb-nav">
          <button v-for="tab in TABS" :key="tab.id" class="nav-btn" :class="{ on: activeTab === tab.id }" @click="switchTab(tab.id)">{{ tab.label }}</button>
        </div>
        <div class="sb-foot">
          <div class="sb-user"><span class="sb-uname">{{ adminUser?.name || adminUser?.phone }}</span><span class="sb-uts">{{ nowStr }}</span></div>
          <button class="sb-logout" @click="logout">Sign out</button>
        </div>
      </nav>

      <main class="content">
        <div v-if="error" class="err-bar" role="alert">{{ error }} <button aria-label="Dismiss error" @click="error = null">✕</button></div>

        <!-- Top-of-tab summary counters (a compact dash) — every data tab -->
        <div v-if="activeTab !== 'overview' && statCards.length" class="stat-row">
          <div class="stat-c" v-for="sc in statCards" :key="sc.label">
            <div class="stat-c-l">{{ sc.label }}</div>
            <div class="stat-c-v">{{ sc.value }}</div>
          </div>
        </div>

        <!-- OVERVIEW — all domain charts shown together; click a card to enlarge -->
        <section v-if="activeTab === 'overview'">
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!stats" class="state-msg">No data available.</div>
          <div v-else class="dash-grid-charts">
            <div
              v-for="c in dashCharts" :key="c.key"
              class="dash-card chart-card"
              role="button" tabindex="0"
              :aria-label="`Enlarge ${c.label} chart`"
              @click="openChart(c.key)"
              @keydown.enter.prevent="openChart(c.key)"
              @keydown.space.prevent="openChart(c.key)"
            >
              <div class="dash-head">
                <h3>{{ c.label }} <span class="dash-sub">· {{ CHART_SUB[c.key] }}</span></h3>
                <div class="dash-head-r"><span class="dash-total">{{ c.value }}</span><AppIcon name="add" :size="15" class="max-ic" title="Enlarge" /></div>
              </div>
              <AdminChart :spec="c" size="sm" />
            </div>
          </div>
        </section>

        <!-- USERS -->
        <section v-if="activeTab === 'users'">
          <div class="filter-row">
            <div class="filter-left">
            <input v-model="searchQ" class="inp flt-search" placeholder="Search name / phone…" aria-label="Search users by name or phone" @keyup.enter="doSearch" />
            <select v-model="filters.users.role" class="flt" @change="applyFilters('users')"><option value="">Role: all</option><option value="citizen">citizen</option><option value="volunteer">volunteer</option><option value="government">government</option><option value="super_admin">super_admin</option></select>
            <select v-model="filters.users.user_type" class="flt" @change="applyFilters('users')"><option value="">Type: all</option><option value="mobile">mobile</option><option value="web">web</option></select>
            <select v-model="filters.users.consent" class="flt" @change="applyFilters('users')"><option value="">Consent: any</option><option value="true">given</option><option value="false">none</option></select>
            <select v-model="filters.users.has_email" class="flt" @change="applyFilters('users')"><option value="">Email: any</option><option value="true">has</option><option value="false">none</option></select>
            </div>
            <div class="filter-actions">
              <button class="flt-clear flt-icon" @click="refreshCurrent" :disabled="loading" title="Refresh" aria-label="Refresh"><AppIcon name="refresh" :size="15" /></button>
              <button class="flt-clear" @click="clearFilters('users')">Clear</button>
              <button class="btn btn-dark" @click="doSearch"><AppIcon name="search" :size="15" /> Search</button>
              <button class="btn btn-dark" @click="openCreate('users')"><AppIcon name="add" :size="16" /> New user</button>
            </div>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.users.columns" :rows="currentRows">
            <template #cell-actions="{ row }"><button class="btn btn-xs" @click="openEdit('users', row)">Edit</button><button class="btn btn-xs" @click="confirmDelete('users', row)">Del</button></template>
          </DataTable>
        </section>

        <!-- REPORTS -->
        <section v-if="activeTab === 'reports'">
          <div class="filter-row">
            <div class="filter-left">
            <input v-model="searchQ" class="inp flt-search" placeholder="Search name / phone…" aria-label="Search reports by name or phone" @keyup.enter="doSearch" />
            <select v-model="filters.reports.status" class="flt" @change="applyFilters('reports')"><option value="">Status: all</option><option v-for="s in REPORT_STATUSES" :key="s" :value="s">{{ s.replace(/_/g, ' ') }}</option></select>
            <select v-model="filters.reports.reported_by" class="flt" @change="applyFilters('reports')"><option value="">Source: all</option><option value="self">self</option><option value="family">family</option></select>
            <select v-model="filters.reports.user_type" class="flt" @change="applyFilters('reports')"><option value="">Origin: all</option><option value="mobile">mobile</option><option value="web">web</option></select>
            <select v-model="filters.reports.disaster_id" class="flt" @change="applyFilters('reports')"><option value="">Disaster: all</option><option value="__any__">in zone</option><option value="__none__">no zone</option><option v-for="d in disasterOptions" :key="d.id" :value="d.id">{{ d.type }} — {{ shortId(d.id) }}</option></select>
            </div>
            <div class="filter-actions">
              <button class="flt-clear flt-icon" @click="refreshCurrent" :disabled="loading" title="Refresh" aria-label="Refresh"><AppIcon name="refresh" :size="15" /></button>
              <button class="flt-clear" @click="clearFilters('reports')">Clear</button>
              <button class="btn btn-dark" @click="doSearch"><AppIcon name="search" :size="15" /> Search</button>
              <button class="btn btn-dark" @click="openCreate('reports')"><AppIcon name="add" :size="16" /> New report</button>
            </div>
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
          <div class="filter-row">
            <div class="filter-left">
            <select v-model="filters.disasters.active" class="flt" @change="applyFilters('disasters')"><option value="">Status: all</option><option value="true">active</option><option value="false">ended</option></select>
            <select v-model="filters.disasters.type" class="flt" @change="applyFilters('disasters')"><option value="">Type: all</option><option v-for="t in DISASTER_TYPES" :key="t" :value="t">{{ t }}</option></select>
            </div>
            <div class="filter-actions">
              <button class="flt-clear flt-icon" @click="refreshCurrent" :disabled="loading" title="Refresh" aria-label="Refresh"><AppIcon name="refresh" :size="15" /></button>
              <button class="flt-clear" @click="clearFilters('disasters')">Clear</button>
              <button class="btn btn-dark" @click="openCreate('disasters')"><AppIcon name="add" :size="16" /> New disaster</button>
            </div>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.disasters.columns" :rows="currentRows">
            <template #cell-actions="{ row }"><button class="btn btn-xs" @click="openEdit('disasters', row)">Edit</button><button class="btn btn-xs" @click="confirmDelete('disasters', row)">Del</button></template>
          </DataTable>
        </section>

        <!-- LINKS -->
        <section v-if="activeTab === 'links'">
          <div class="filter-row">
            <div class="filter-left">
            <input v-model="searchQ" class="inp flt-search" placeholder="Search name / phone…" aria-label="Search links by name or phone" @keyup.enter="doSearch" />
            <select v-model="filters.links.status" class="flt" @change="applyFilters('links')"><option value="">Status: all</option><option value="confirmed">confirmed</option><option value="pending">pending</option><option value="blocked">blocked</option></select>
            </div>
            <div class="filter-actions">
              <button class="flt-clear flt-icon" @click="refreshCurrent" :disabled="loading" title="Refresh" aria-label="Refresh"><AppIcon name="refresh" :size="15" /></button>
              <button class="flt-clear" @click="clearFilters('links')">Clear</button>
              <button class="btn btn-dark" @click="doSearch"><AppIcon name="search" :size="15" /> Search</button>
            </div>
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
          <div class="filter-row">
            <div class="filter-left">
            <select v-model="filters.devices.platform" class="flt" @change="applyFilters('devices')"><option value="">Platform: all</option><option value="ios">iOS</option><option value="android">Android</option></select>
            <select v-model="filters.devices.located" class="flt" @change="applyFilters('devices')"><option value="">GPS: any</option><option value="true">has</option><option value="false">none</option></select>
            <select v-model="filters.devices.linked" class="flt" @change="applyFilters('devices')"><option value="">Account: any</option><option value="true">linked</option><option value="false">unlinked</option></select>
            </div>
            <div class="filter-actions">
              <button class="flt-clear flt-icon" @click="refreshCurrent" :disabled="loading" title="Refresh" aria-label="Refresh"><AppIcon name="refresh" :size="15" /></button>
              <button class="flt-clear" @click="clearFilters('devices')">Clear</button>
            </div>
          </div>
          <div v-if="loading" class="state-msg" role="status">Loading…</div>
          <div v-else-if="!currentRows.length" class="state-msg">No records.</div>
          <DataTable v-else :columns="TAB_CONFIG.devices.columns" :rows="currentRows">
            <template #cell-actions="{ row }"><button class="btn btn-xs" @click="confirmDelete('devices', row)">Del</button></template>
          </DataTable>
        </section>

        <!-- AUDIT -->
        <section v-if="activeTab === 'audit'">
          <div class="filter-row">
            <div class="filter-left">
            <select v-model="filters.audit.action" class="flt" @change="applyFilters('audit')"><option value="">Action: all</option><option value="create">create</option><option value="update">update</option><option value="delete">delete</option><option value="login">login</option></select>
            <select v-model="filters.audit.entity" class="flt" @change="applyFilters('audit')"><option value="">Entity: all</option><option value="users">users</option><option value="reports">reports</option><option value="disasters">disasters</option><option value="account_links">links</option><option value="device_push_tokens">devices</option></select>
            </div>
            <div class="filter-actions">
              <button class="flt-clear flt-icon" @click="refreshCurrent" :disabled="loading" title="Refresh" aria-label="Refresh"><AppIcon name="refresh" :size="15" /></button>
              <button class="flt-clear" @click="clearFilters('audit')">Clear</button>
            </div>
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

    <!-- CHART POP-UP — click a dashboard card to enlarge that chart -->
    <div v-if="activeChart" class="overlay" @click.self="closeChart">
      <div ref="chartModalEl" class="modal pop-modal" role="dialog" aria-modal="true" aria-labelledby="pop-title" tabindex="-1">
        <div class="modal-hd"><h3 id="pop-title">{{ currentChart?.label }} <span class="dash-sub">· {{ CHART_SUB[activeChart] }}</span></h3><button class="modal-x" aria-label="Close" @click="closeChart">✕</button></div>
        <div class="pop-body"><AdminChart v-if="currentChart" :spec="currentChart" size="lg" /></div>
      </div>
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
.login-input { padding:10px 12px; border:1px solid #dedee2; font-size:14px; color:#1e1e22; background:#fff; width:100%; box-sizing:border-box; font-family:inherit; border-radius:3px; }
.login-input:focus { border-color:#26262b; box-shadow:0 0 0 3px rgba(38,38,43,0.08); outline:none; }

/* ── Shell ──────────────────────────────────────────────── */
.shell { display:flex; height:100vh; background:#f1f2f5; font-family:var(--font-ui); font-size:14px; color:#1e1e22; overflow:hidden; }
.body { display:flex; flex:1; min-height:0; width:100%; }

/* ── Sidebar — the sole chrome: brand (top) · nav · user/sign-out (bottom).
   Grey; the content area is a shade lighter so the sidebar reads as the rail. */
.sidebar { width:200px; background:#e6e7eb; border-right:1px solid #d7d8dd; display:flex; flex-direction:column; flex-shrink:0; }
.sb-top { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:15px 14px; border-bottom:1px solid #dbdce1; }
.sb-brand { display:flex; flex-direction:column; line-height:1.2; min-width:0; }
.sb-name { font-size:15px; font-weight:700; color:#1e1e22; letter-spacing:-0.01em; }
.sb-sub { font-size:11.5px; color:#8a8b93; font-weight:500; }
.sb-nav { flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:3px; }
.nav-btn { display:block; padding:9px 12px; background:transparent; border:none; color:#5b5c63; cursor:pointer; text-align:left; font-size:13.5px; font-weight:500; font-family:inherit; width:100%; border-radius:3px; height:auto; }
.nav-btn:hover { color:#1e1e22; background:#dcdde2; }
.nav-btn.on { color:#fff; font-weight:600; background:#26262b; }
.sb-foot { padding:12px 14px; border-top:1px solid #dbdce1; display:flex; flex-direction:column; gap:8px; }
.sb-user { display:flex; flex-direction:column; line-height:1.3; min-width:0; }
.sb-uname { font-size:13px; font-weight:600; color:#1e1e22; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sb-uts { font-size:11px; color:#9a9ba3; font-family:var(--font-mono); }
.sb-logout { padding:7px 12px; background:#fff; border:1px solid #d7d8dd; color:#5b5c63; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; border-radius:3px; }
.sb-logout:hover { border-color:#c4c4ca; color:#1e1e22; }

/* ── Content (grey — a shade lighter than the sidebar) ───── */
.content { flex:1; min-width:0; overflow:auto; padding:22px 26px; display:flex; flex-direction:column; gap:16px; background:#f1f2f5; }

/* ── Stat row (top-of-tab summary counters — the per-tab "dash") ── */
.stat-row { display:flex; flex-wrap:wrap; gap:10px; }
.stat-c { background:#fff; border:1px solid #e6e7ea; border-radius:3px; padding:8px 13px; min-width:100px; }
.stat-c-l { font-size:10px; font-weight:600; color:#9a9ba3; text-transform:uppercase; letter-spacing:0.03em; white-space:nowrap; }
.stat-c-v { font-size:16px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); line-height:1; margin-top:3px; }

/* ── Typography / toolbar ──────────────────────────────── */
.page-title { font-size:19px; font-weight:700; color:#1e1e22; margin:0; letter-spacing:-0.01em; }
.toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.toolbar-r { display:flex; align-items:center; gap:10px; }
.search-bar { display:flex; }
.search-bar .inp { width:220px; height:38px; border-top-right-radius:0; border-bottom-right-radius:0; border-right:none; }
.search-bar .btn { border-top-left-radius:0; border-bottom-left-radius:0; }

/* ── Filter bar — sits directly on the grey content (no card); only the
   input/select boxes are white so they read as the fields. ─── */
.filter-row { display:flex; align-items:flex-start; gap:14px; flex-wrap:nowrap; background:transparent; border:none; padding:0; margin-bottom:16px; }
.filter-left { display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex:1 1 auto; min-width:0; }
@media (max-width: 760px) { .filter-row { flex-wrap:wrap; } }
.filter-row .flt-search { width:220px; max-width:100%; flex-shrink:0; }
.flt { width:auto; min-width:120px; padding:8px 12px; border:1px solid #dedee2; background:#fff; font-size:13px; color:#3a3a41; font-family:inherit; cursor:pointer; border-radius:3px; height:auto; }
.flt:focus { border-color:#26262b; box-shadow:0 0 0 3px rgba(38,38,43,0.07); outline:none; }
.flt.inline { padding:5px 8px; font-size:12px; }
/* Right-aligned action group: Clear (outline) + Search/New (charcoal). */
.filter-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.flt-clear { height:38px; padding:0 15px; display:inline-flex; align-items:center; font-size:13px; font-weight:600; background:transparent; border:1px solid #cbccd2; color:#5b5c63; cursor:pointer; font-family:inherit; border-radius:3px; }
.flt-clear:hover { background:#e4e5e9; color:#1e1e22; border-color:#b7b8bf; }
.flt-icon { width:38px; padding:0; justify-content:center; }

/* ── Inputs ────────────────────────────────────────────── */
.inp { padding:9px 12px; border:1px solid #dedee2; font-size:14px; color:#1e1e22; background:#fff; width:100%; font-family:inherit; border-radius:3px; }
.inp:focus { border-color:#26262b; box-shadow:0 0 0 3px rgba(38,38,43,0.07); outline:none; }

/* ── Buttons ───────────────────────────────────────────── */
.btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; height:38px; padding:0 15px; border:1px solid #dedee2; background:#fff; color:#3a3a41; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; border-radius:3px; white-space:nowrap; }
.btn:hover:not(:disabled) { background:#f3f3f5; border-color:#c4c4ca; color:#1e1e22; }
.btn:active:not(:disabled) { background:#ebebee; }
.btn:disabled { opacity:.4; cursor:not-allowed; }
.btn-dark { background:#26262b; color:#fff; border-color:#26262b; }
.btn-dark:hover:not(:disabled) { background:#131316; border-color:#131316; color:#fff; }
.btn-dark:active:not(:disabled) { background:#000; }
.btn-xs { height:30px; padding:0 11px; font-size:12px; border-radius:3px; }

/* ── Table cell content (rendered into DataTable slots) ── */
.sub { color:#9a9ba3; font-size:12px; }

/* ── Dashboard (Overview) — all charts shown at once; click a card to enlarge ── */
.dash-grid-charts { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap:14px; }
.dash-card { background:#fff; border:1px solid #e9e9ec; border-radius:4px; padding:16px 18px; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
.dash-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:16px; }
.dash-head h3 { margin:0; font-size:14px; font-weight:700; color:#1e1e22; }
.dash-sub { color:#9a9ba3; font-weight:500; }
.dash-head-r { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.dash-total { font-size:30px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); line-height:1; }
.max-ic { color:#c4c4ca; }

/* Each card is a clickable "pop" target that enlarges its chart in a modal. */
.chart-card { cursor:pointer; }
.chart-card:hover { border-color:#c4c4ca; box-shadow:0 3px 10px rgba(0,0,0,0.07); }
.chart-card:hover .max-ic { color:#26262b; }
.chart-card:focus-visible { outline:2px solid #26262b; outline-offset:2px; }

/* Enlarge modal (chart shown at size="lg") */
.pop-modal { width:min(640px, 94vw); }
.pop-body { padding:22px 24px 26px; }

/* ── Pagination ────────────────────────────────────────── */
.pager { display:flex; align-items:center; gap:8px; padding-top:2px; }
.pager-info { font-size:13px; color:#9a9ba3; margin-right:auto; }

/* ── States ────────────────────────────────────────────── */
.err-bar { display:flex; align-items:center; gap:8px; padding:11px 14px; background:#fff; border:1px solid #e9e9ec; border-left:3px solid #26262b; color:#1e1e22; font-size:13px; border-radius:3px; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
.err-bar button { margin-left:auto; background:none; border:none; cursor:pointer; color:#9a9ba3; font-size:14px; height:auto; padding:0; }
.form-err { padding:9px 12px; background:#f7f7f8; border:1px solid #dedee2; border-left:3px solid #26262b; font-size:13px; color:#1e1e22; border-radius:3px; }
.state-msg { color:#9a9ba3; padding:28px 4px; font-size:14px; text-align:center; background:#fff; border:1px solid #e9e9ec; border-radius:4px; }

/* ── Modal ──────────────────────────────────────────────── */
.overlay { position:fixed; inset:0; background:rgba(20,20,24,.42); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; }
.modal { background:#fff; width:460px; max-width:96vw; max-height:90vh; overflow-y:auto; border:1px solid #e3e3e7; border-radius:4px; box-shadow:0 20px 60px rgba(0,0,0,0.22); }
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
