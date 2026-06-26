<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { getRescueView, getDisasters, getShelters, createIncident, getActiveIncidents, resolveIncident } from '../api.js';
import { GOV_TOKEN_KEY } from '../router/index.js';
import { useSocket } from '../socket.js';
import TriageRow from '../components/TriageRow.vue';
import LeafletMap from '../components/LeafletMap.vue';
import StatusIcon from '../components/StatusIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { STATUS_SHORT, STATUS_COLOR_VIVID } from '../iconography.js';

// ── Auth ──────────────────────────────────────────────────────────
const token         = ref(sessionStorage.getItem(GOV_TOKEN_KEY) || '');
const needsAuth     = ref(!token.value);
const passwordInput = ref('');
const authError     = ref(null);
const authBusy      = ref(false);

// ── Map / query state ─────────────────────────────────────────────
const center = ref({ lat: 22.3193, lng: 114.1694 }); // Hong Kong
const radius = ref(20);

// ── Data ──────────────────────────────────────────────────────────
const allResults  = ref([]);
const allResultsGlobal = ref([]); // unscoped by disaster — fixed wide radius, "all data"
const disasters   = ref([]);
const shelters    = ref([]);
const sheltersGlobal = ref([]); // unscoped by disaster — fixed wide radius
const loading     = ref(false);
const highlightId = ref(null);
const selectedPersonId = ref(null);

// Map scope: 'all' shows every user/shelter/disaster zone; 'disaster' scopes
// to the currently selected disaster's radius (same data as the side panels).
const mapScope = ref('all');

// ── Sidebar nav active section ────────────────────────────────────
const activeSection = ref('rescue-queue');

// ── Status filters ────────────────────────────────────────────────
const statusFilters = ref({
  need_help:           true,
  injured:             true,
  awaiting_response:   true,
  potentially_missing: true,
  missing:             true,
  safe:                false,
});

// ── Map layer visibility ──────────────────────────────────────────
const mapLayers = ref({
  need_help:           true,
  injured:             true,
  awaiting_response:   true,
  potentially_missing: true,
  missing:             true,
  safe:                false,
  shelters:            true,
  hospitals:           true,
});

// ── Alert log (ring buffer, last 20) ─────────────────────────────
const alerts = ref([]);

function addAlert(msg, level = 'info') {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  alerts.value = [{ ts, msg, level }, ...alerts.value].slice(0, 20);
}

// ── CFR: responder dispatch ───────────────────────────────────────
const incidents = ref([]);
const cfrForm   = ref({ type: 'cardiac_arrest', lat: '', lng: '', is_public: true });
const cfrBusy   = ref(false);
const cfrMsg    = ref(null);
const INCIDENT_TYPES = [
  { v: 'cardiac_arrest', label: 'Cardiac arrest' },
  { v: 'fire',           label: 'Fire' },
  { v: 'trauma',         label: 'Trauma' },
  { v: 'other',          label: 'Other' },
];

async function loadIncidents() {
  if (!token.value) return;
  try {
    incidents.value = (await getActiveIncidents(token.value)).incidents || [];
  } catch { /* 401 handled by fetchAll */ }
}

function useMapCenter() {
  cfrForm.value.lat = center.value.lat.toFixed(5);
  cfrForm.value.lng = center.value.lng.toFixed(5);
}

async function dispatchIncident() {
  cfrMsg.value = null;
  const lat = Number(cfrForm.value.lat), lng = Number(cfrForm.value.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    cfrMsg.value = { level: 'error', text: 'Enter valid coordinates.' };
    return;
  }
  cfrBusy.value = true;
  try {
    const res = await createIncident(
      { type: cfrForm.value.type, lat, lng, is_public: cfrForm.value.is_public },
      token.value,
    );
    if (res.incident === null) {
      cfrMsg.value = { level: 'warn', text: 'Suppressed — an active incident already covers this location.' };
    } else {
      cfrMsg.value = { level: 'info', text: `Dispatched — ${res.matched} responder(s) alerted.` };
      addAlert(`INCIDENT: ${cfrForm.value.type} dispatched — ${res.matched} responder(s) alerted`, 'critical');
    }
    await loadIncidents();
  } catch (e) {
    cfrMsg.value = { level: 'error', text: e.message || 'Dispatch failed.' };
  } finally {
    cfrBusy.value = false;
  }
}

async function standDown(id) {
  try { await resolveIncident(id, token.value); await loadIncidents(); }
  catch (e) { addAlert(`Failed to stand down incident: ${e.message}`, 'warn'); }
}

// ── Real-time ─────────────────────────────────────────────────────
const { onDisasterAlert, onMissingAlert, onIncidentUpdate, onIncidentResolved } = useSocket();
let offAlert = null, offMissing = null, offIncUpdate = null, offIncResolved = null;

const triageScrollEl = ref(null);
let debounceTimer = null;
let refreshTimer  = null;

// ── Computed ──────────────────────────────────────────────────────
const filteredResults = computed(() =>
  allResults.value.filter((r) => statusFilters.value[r.status] ?? true)
);

const p1 = computed(() => filteredResults.value.filter((r) => r.priority === 0));
const p2 = computed(() => filteredResults.value.filter((r) => r.priority === 1));
const p3 = computed(() => filteredResults.value.filter((r) => r.priority >= 2));

const cmdStats = computed(() => {
  const all = allResults.value;
  let need_help = 0, awaiting = 0, pot_missing = 0, missing_only = 0, injured = 0, safe = 0;
  for (const r of all) {
    switch (r.status) {
      case 'need_help':           need_help++; break;
      case 'awaiting_response':   awaiting++; break;
      case 'potentially_missing': pot_missing++; break;
      case 'missing':             missing_only++; break;
      case 'injured':             injured++; break;
      case 'safe':                safe++; break;
    }
  }
  return {
    active_disasters: disasters.value.length,
    total:            all.length,
    checked_in:       safe + injured + need_help,
    need_help,
    awaiting,
    missing:          pot_missing + missing_only,
    pot_missing,
    missing_only,
    injured,
    safe,
  };
});

// Real status distribution for the analytics dock (no fabricated telemetry).
const distribution = computed(() => [
  { key: 'need_help',           n: cmdStats.value.need_help },
  { key: 'injured',             n: cmdStats.value.injured },
  { key: 'awaiting_response',   n: cmdStats.value.awaiting },
  { key: 'potentially_missing', n: cmdStats.value.pot_missing },
  { key: 'missing',             n: cmdStats.value.missing_only },
  { key: 'safe',                n: cmdStats.value.safe },
]);

// Same shape as cmdStats/distribution but over allResultsGlobal (fixed wide
// radius, ignores the currently selected disaster) — the "all data" totals.
const cmdStatsGlobal = computed(() => {
  const all = allResultsGlobal.value;
  let need_help = 0, awaiting = 0, pot_missing = 0, missing_only = 0, injured = 0, safe = 0;
  for (const r of all) {
    switch (r.status) {
      case 'need_help':           need_help++; break;
      case 'awaiting_response':   awaiting++; break;
      case 'potentially_missing': pot_missing++; break;
      case 'missing':             missing_only++; break;
      case 'injured':             injured++; break;
      case 'safe':                safe++; break;
    }
  }
  return { total: all.length, need_help, awaiting, pot_missing, missing_only, injured, safe };
});

const distributionGlobal = computed(() => [
  { key: 'need_help',           n: cmdStatsGlobal.value.need_help },
  { key: 'injured',             n: cmdStatsGlobal.value.injured },
  { key: 'awaiting_response',   n: cmdStatsGlobal.value.awaiting },
  { key: 'potentially_missing', n: cmdStatsGlobal.value.pot_missing },
  { key: 'missing',             n: cmdStatsGlobal.value.missing_only },
  { key: 'safe',                n: cmdStatsGlobal.value.safe },
]);

// ── Radar chart (pure SVG, no charting lib) ──────────────────────
// 5 axes mapped to 0-100%. Two polygons: current disaster vs global baseline.
const RADAR_AXES = ['EMERGENCY NEED', 'MEDICAL LOAD', 'MISSING RISK', 'AWAITING DISPATCH', 'UNACCOUNTED GAP'];
const RC = 100, RR = 80; // viewBox center + max radius

const radarPct = (s) => {
  const t = s.total || 1;
  const checked = s.checked_in ?? (s.safe + s.injured + s.need_help);
  return [
    s.need_help / t,
    s.injured / t,
    (s.pot_missing + s.missing_only) / t,
    s.awaiting / t,
    (t - checked) / t,
  ].map((v) => Math.min(100, Math.round(v * 100)));
};

// vals: array of 5 percentages → "x,y x,y ..." for a <polygon>
const radarPts = (vals) => vals.map((v, i) => {
  const a = (-90 + i * 72) * Math.PI / 180;
  const r = RR * (v / 100);
  const x = RC + r * Math.cos(a);
  const y = RC + r * Math.sin(a);
  return `${x.toFixed(1)},${y.toFixed(1)}`;
}).join(' ');

const radarCurrent  = computed(() => radarPts(radarPct(cmdStats.value)));
const radarBaseline = computed(() => radarPts(radarPct(cmdStatsGlobal.value)));
const radarRings    = [20, 40, 60, 80, 100].map((p) => radarPts([p, p, p, p, p]));
const radarAxes     = RADAR_AXES.map((label, i) => {
  const a = (-90 + i * 72) * Math.PI / 180;
  return {
    label,
    x2: (RC + RR * Math.cos(a)).toFixed(1),
    y2: (RC + RR * Math.sin(a)).toFixed(1),
    lx: (RC + (RR + 14) * Math.cos(a)).toFixed(1),
    ly: (RC + (RR + 14) * Math.sin(a)).toFixed(1),
  };
});

const isMaximized = ref(false);

// Accounted-for ring: people who have checked in vs total reports (real).
const accountedPct = computed(() => {
  const s = cmdStats.value;
  return s.total ? Math.round((s.checked_in / s.total) * 100) : 0;
});

const selectedDisasterId = ref(null);
const activeDisaster = computed(() => {
  if (selectedDisasterId.value) return disasters.value.find((d) => d.id === selectedDisasterId.value) || null;
  return disasters.value[0] || null;
});

// In 'all' scope every active disaster zone is drawn; in 'disaster' scope
// only the one currently selected on the DISASTERS tab.
const mapDisasterZones = computed(() => {
  const list = mapScope.value === 'all' ? disasters.value : (activeDisaster.value ? [activeDisaster.value] : []);
  return list.map((d) => ({ lat: d.lat, lng: d.lng, radius_km: d.radius_km, type: d.type, id: d.id }));
});

// Great-circle distance (km) — used to scope facilities to a disaster zone.
function kmBetween(aLat, aLng, bLat, bLng) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ALL → every report. BY DISASTER → only reports linked to the selected
// disaster (report.disaster_id), nothing else. Layer toggles still apply.
const mapReports = computed(() => {
  const d = activeDisaster.value;
  const base = mapScope.value === 'all'
    ? allResultsGlobal.value
    : (d ? allResultsGlobal.value.filter((r) => r.disaster_id === d.id) : []);
  return base.filter((r) => mapLayers.value[r.status] ?? true);
});

// ALL → every facility. BY DISASTER → only facilities inside the selected
// disaster's zone (within its radius).
const mapShelters = computed(() => {
  const d = activeDisaster.value;
  const base = mapScope.value === 'all'
    ? sheltersGlobal.value
    : (d ? sheltersGlobal.value.filter((s) => kmBetween(d.lat, d.lng, s.lat, s.lng) <= d.radius_km) : []);
  return base.filter((s) => {
    if (s.type === 'hospital' || s.type === 'clinic') return mapLayers.value.hospitals;
    return mapLayers.value.shelters;
  });
});

const selectedPerson = computed(() =>
  selectedPersonId.value
    ? allResults.value.find((r) => r.id === selectedPersonId.value) || null
    : null
);

// ── Actions ───────────────────────────────────────────────────────
async function fetchAll() {
  if (!token.value) return;
  loading.value = true;
  try {
    const lat = center.value.lat, lng = center.value.lng, r = radius.value;
    const [rescueRes, globalRes, disasterRes, shelterRes, shelterGlobalRes] = await Promise.all([
      getRescueView(lat, lng, r, token.value),
      getRescueView(center.value.lat, center.value.lng, 1000, token.value),
      getDisasters(),
      getShelters({ lat, lng, radius: r * 2 }),
      getShelters({ lat: center.value.lat, lng: center.value.lng, radius: 500 }),
    ]);
    allResults.value       = rescueRes.results   || [];
    allResultsGlobal.value = globalRes.results   || [];
    disasters.value  = disasterRes.disasters || [];
    shelters.value   = shelterRes.shelters  || [];
    sheltersGlobal.value = shelterGlobalRes.shelters || [];
    loadIncidents();
  } catch (err) {
    if (err.status === 401) {
      sessionStorage.removeItem(GOV_TOKEN_KEY);
      token.value = '';
      needsAuth.value = true;
    }
  } finally {
    loading.value = false;
  }
}

async function submitToken() {
  authBusy.value  = true;
  authError.value = null;
  try {
    await getRescueView(center.value.lat, center.value.lng, radius.value, passwordInput.value);
    token.value = passwordInput.value;
    sessionStorage.setItem(GOV_TOKEN_KEY, token.value);
    needsAuth.value     = false;
    passwordInput.value = '';
    await fetchAll();
    addAlert('Dashboard authenticated. Live data feed active.', 'info');
  } catch (err) {
    authError.value = err.status === 401
      ? 'Invalid token. Access denied.'
      : 'Could not verify token. Please try again.';
  } finally {
    authBusy.value = false;
  }
}

const leafletMapRef = ref(null);

function onMarkerClick(reportId) {
  highlightId.value    = reportId;
  selectedPersonId.value = reportId;
  activeSection.value  = 'rescue-queue';
  nextTick(() => {
    const el     = document.getElementById(`triage-${reportId}`);
    const scroll = triageScrollEl.value;
    if (el && scroll) scroll.scrollTop = el.offsetTop - scroll.clientHeight / 2;
  });
  const r = allResultsGlobal.value.find((x) => x.id === reportId) || allResults.value.find((x) => x.id === reportId);
  if (r) leafletMapRef.value?.flyTo(r.lat, r.lng);
}

// Keep the header coordinates honest: track the live map centre as the user
// pans, zooms, selects a disaster, or flies to a marker.
function onMapMove({ lat, lng }) {
  center.value = { lat, lng };
}

function locateShelter(s) {
  leafletMapRef.value?.flyTo(s.lat, s.lng);
}

function selectDisaster(d) {
  selectedDisasterId.value = d.id;
  center.value = { lat: d.lat, lng: d.lng };
  radius.value = d.radius_km;
  fetchAll();
}

function logout() {
  sessionStorage.removeItem(GOV_TOKEN_KEY);
  token.value = '';
  needsAuth.value = true;
}

onMounted(() => {
  if (token.value) fetchAll();
  refreshTimer = setInterval(() => { if (token.value) fetchAll(); }, 15000);

  offAlert  = onDisasterAlert((d) => {
    if (!disasters.value.find((x) => x.id === d.id)) disasters.value = [d, ...disasters.value];
    addAlert(`ALERT: ${d.type.toUpperCase()} detected — ${d.description || d.radius_km + 'km radius'}`, 'critical');
  });
  offMissing = onMissingAlert((payload) => {
    addAlert(`${payload.ids.length} report(s) escalated to Potentially Missing`, 'warn');
    fetchAll();
  });
  offIncUpdate   = onIncidentUpdate(() => { loadIncidents(); });
  offIncResolved = onIncidentResolved(() => { loadIncidents(); });
});

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (refreshTimer)  clearInterval(refreshTimer);
  offAlert?.();
  offMissing?.();
  offIncUpdate?.();
  offIncResolved?.();
});

// ── Display helpers ───────────────────────────────────────────────
const STATUS_LABEL = STATUS_SHORT;
const statusColorMap = STATUS_COLOR_VIVID;

function relativeTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
</script>

<template>
  <!-- ── Auth Gate — same design as the Admin console login ─────── -->
  <div v-if="needsAuth" class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <div class="crest">報</div>
        <h1>Report Safe</h1>
        <p class="login-sub">Government EOC Dashboard</p>
        <div class="classification">RESTRICTED · GOVERNMENT USE ONLY</div>
      </div>
      <form @submit.prevent="submitToken" class="login-form">
        <label class="field-label">Access token</label>
        <input v-model="passwordInput" class="login-input" type="password" placeholder="GOV-SECRET-KEY..." autocomplete="off" autofocus required />
        <div v-if="authError" class="login-error">{{ authError }}</div>
        <button class="login-btn" type="submit" :disabled="authBusy">
          {{ authBusy ? 'Verifying…' : 'Sign in' }}
        </button>
      </form>
      <p class="login-note">Restricted access — government personnel only</p>
    </div>
  </div>

  <div v-else class="dashboard-root-dark">

      <div class="dashboard-grid-workspace">

        <!-- ── LEFT: Tactical routing ──────────────────────────────── -->
        <div class="pane-column">
          <div class="pane-header-strip">
            <span class="pane-title">TACTICAL ROUTING CONTROL</span>
            <div class="pane-badge-status" :class="{ scanning: loading }">{{ loading ? 'FETCHING' : 'READY' }}</div>
          </div>

          <div class="pane-navigation-tabs">
            <button :class="{ active: activeSection === 'rescue-queue' }" @click="activeSection = 'rescue-queue'">TRIAGE</button>
            <button :class="{ active: activeSection === 'incidents' }" @click="activeSection = 'incidents'">DISASTERS</button>
            <button :class="{ active: activeSection === 'cfr' }" @click="activeSection = 'cfr'">DISPATCH</button>
            <button :class="{ active: activeSection === 'tools' }" @click="activeSection = 'tools'">LAYERS</button>
          </div>

          <div class="pane-inner-scroller">

            <!-- TRIAGE -->
            <div v-if="activeSection === 'rescue-queue'" class="sub-wrapper">
              <!-- Status filters (core EOC control) -->
              <div class="filter-chip-row">
                <button
                  v-for="(on, key) in statusFilters"
                  :key="key"
                  class="filter-chip"
                  :class="{ on }"
                  @click="statusFilters[key] = !statusFilters[key]"
                >{{ STATUS_LABEL[key] }}</button>
              </div>

              <div ref="triageScrollEl" class="cyber-queue-stack">
                <div v-if="p1.length > 0" class="queue-category">
                  <div class="category-divider text-red">CRITICAL PRIORITY P1 · {{ p1.length }}</div>
                  <div v-for="(r, i) in p1" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" @click="onMarkerClick(r.id)">
                    <TriageRow :report="r" :index="i" :highlight="highlightId === r.id" />
                  </div>
                </div>
                <div v-if="p2.length > 0" class="queue-category">
                  <div class="category-divider text-orange">MEDICAL ESCALATION P2 · {{ p2.length }}</div>
                  <div v-for="(r, i) in p2" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" @click="onMarkerClick(r.id)">
                    <TriageRow :report="r" :index="p1.length + i" :highlight="highlightId === r.id" />
                  </div>
                </div>
                <div v-if="p3.length > 0" class="queue-category">
                  <div class="category-divider text-yellow">MONITOR / WELFARE P3 · {{ p3.length }}</div>
                  <div v-for="(r, i) in p3" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" @click="onMarkerClick(r.id)">
                    <TriageRow :report="r" :index="p1.length + p2.length + i" :highlight="highlightId === r.id" />
                  </div>
                </div>
                <div v-if="filteredResults.length === 0" class="cyber-empty-notice">No records match current parameters.</div>
              </div>
            </div>

            <!-- DISASTERS -->
            <div v-if="activeSection === 'incidents'" class="sub-wrapper">
              <div v-for="d in disasters" :key="d.id" class="cyber-list-row" :class="{ active: activeDisaster?.id === d.id }" @click="selectDisaster(d)">
                <div class="row-flex-meta"><strong>{{ d.type }}</strong><span>{{ d.radius_km }} KM</span></div>
                <div class="row-flex-desc">{{ d.description }}</div>
              </div>
              <div v-if="disasters.length === 0" class="cyber-empty-notice">No active disasters.</div>
            </div>

            <!-- DISPATCH (CFR) -->
            <div v-if="activeSection === 'cfr'" class="sub-wrapper cyber-form-layout">
              <div class="form-title">DEPLOY EMERGENCY UNIT</div>
              <div class="field-wrap">
                <label>Profile Classification</label>
                <select v-model="cfrForm.type" class="cyber-select">
                  <option v-for="it in INCIDENT_TYPES" :key="it.v" :value="it.v">{{ it.label }}</option>
                </select>
              </div>
              <div class="field-row-split">
                <div class="field-wrap">
                  <label>Lat</label>
                  <input v-model="cfrForm.lat" class="cyber-field" />
                </div>
                <div class="field-wrap">
                  <label>Lng</label>
                  <input v-model="cfrForm.lng" class="cyber-field" />
                </div>
              </div>
              <label class="topology-checkbox-item">
                <input type="checkbox" v-model="cfrForm.is_public" />
                <span>Public place (residential → verified responders only)</span>
              </label>
              <button class="cyber-btn-dim" @click="useMapCenter">SNAP CENTER POINT</button>
              <button class="cyber-btn-bright" :disabled="cfrBusy" @click="dispatchIncident">{{ cfrBusy ? 'DISPATCHING…' : 'EXECUTE UNIT DISPATCH' }}</button>
              <div v-if="cfrMsg" class="form-feedback-banner" :class="cfrMsg.level">{{ cfrMsg.text }}</div>

              <div class="form-title" style="margin-top:14px;">ACTIVE INCIDENTS · {{ incidents.length }}</div>
              <div v-for="inc in incidents" :key="inc.id" class="cyber-list-row" style="cursor:default;">
                <div class="row-flex-meta">
                  <strong>{{ inc.type }}<span v-if="!inc.is_public"> · residential</span></strong>
                  <button class="cyber-btn-dim" style="padding:2px 6px;" @click="standDown(inc.id)">STAND DOWN</button>
                </div>
                <div class="row-flex-desc">
                  {{ inc.lat.toFixed(4) }}, {{ inc.lng.toFixed(4) }}
                  · {{ inc.responder_counts.responders }} resp · {{ inc.responder_counts.enroute }} en route · {{ inc.responder_counts.onscene }} on scene
                </div>
              </div>
              <div v-if="incidents.length === 0" class="cyber-empty-notice">No active incidents.</div>
            </div>

            <!-- LAYERS / TOOLS -->
            <div v-if="activeSection === 'tools'" class="sub-wrapper">
              <div class="form-title">TOPOLOGICAL FILTERS</div>
              <div class="topology-grid">
                <label v-for="(on, key) in mapLayers" :key="key" class="topology-checkbox-item">
                  <input type="checkbox" v-model="mapLayers[key]" />
                  <span>{{ STATUS_LABEL[key] || (key === 'shelters' ? 'Shelters' : 'Hospitals') }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- ── CENTER: Map + real analytics ────────────────────────── -->
        <div class="pane-column center-workspace-pane">
          <div class="pane-header-strip">
            <span class="pane-title">CENTRAL GEOSPATIAL INTELLIGENCE MAP</span>
            <span class="pane-coordinates">{{ center.lat.toFixed(4) }}°N // {{ center.lng.toFixed(4) }}°E</span>
          </div>

          <div class="gis-map-viewport">
            <div class="map-scope-toggle">
              <button :class="{ active: mapScope === 'all' }" @click="mapScope = 'all'">ALL</button>
              <button :class="{ active: mapScope === 'disaster' }" @click="mapScope = 'disaster'">BY DISASTER</button>
            </div>
            <LeafletMap ref="leafletMapRef" :reports="mapReports" :disasters="mapDisasterZones" :shelters="mapShelters" :layers="mapLayers" @markerClick="onMarkerClick" @move="onMapMove" />
          </div>

          <div class="pane-analytics-dock">
            <!-- LEFT 50%: status distribution bars -->
            <div class="dock-half">
              <div class="card-caption">STATUS DISTRIBUTION — BY DISASTER · {{ cmdStats.total }} RECORDS</div>
              <div class="dist-bar">
                <div
                  v-for="seg in distribution"
                  :key="seg.key"
                  class="dist-seg"
                  :style="{ flexGrow: seg.n || 0, background: statusColorMap[seg.key] }"
                  :title="`${STATUS_LABEL[seg.key]}: ${seg.n}`"
                ></div>
              </div>
              <div class="card-caption">STATUS DISTRIBUTION — ALL DATA · {{ cmdStatsGlobal.total }} RECORDS</div>
              <div class="dist-bar">
                <div
                  v-for="seg in distributionGlobal"
                  :key="seg.key"
                  class="dist-seg"
                  :style="{ flexGrow: seg.n || 0, background: statusColorMap[seg.key] }"
                  :title="`${STATUS_LABEL[seg.key]}: ${seg.n}`"
                ></div>
              </div>
              <div class="dist-legend">
                <span v-for="seg in distributionGlobal" :key="seg.key" class="dist-legend-item">
                  <i :style="{ background: statusColorMap[seg.key] }"></i>{{ STATUS_LABEL[seg.key] }} {{ seg.n }}
                </span>
              </div>
            </div>

            <!-- RIGHT 50%: radar chart -->
            <div class="dock-half radar-half">
              <div class="radar-header">
                <span class="card-caption">RISK RADAR — CURRENT vs GLOBAL</span>
                <button class="radar-max-btn" @click="isMaximized = true" title="Maximize">⛶ Maximize</button>
              </div>
              <svg class="radar-svg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
                <polygon v-for="(ring, i) in radarRings" :key="i" :points="ring" class="radar-ring" />
                <line v-for="ax in radarAxes" :key="ax.label" :x1="RC" :y1="RC" :x2="ax.x2" :y2="ax.y2" class="radar-spoke" />
                <polygon :points="radarBaseline" class="radar-baseline" />
                <polygon :points="radarCurrent" class="radar-current" />
              </svg>
            </div>
          </div>
        </div>

        <!-- ── RIGHT: Inspector + distribution ring + logs ─────────── -->
        <div class="pane-column">

          <div v-if="selectedPerson" class="pane-sub-segment separation-border">
            <div class="pane-header-strip highlight-alert-bg">
              <span class="pane-title">TARGET TELEMETRY INSPECTOR</span>
              <button class="dismiss-btn" @click="selectedPersonId = null">×</button>
            </div>
            <div class="inspector-profile-card">
              <div class="profile-summary-row">
                <StatusIcon :status="selectedPerson.status" :size="28" :vivid="true" />
                <div>
                  <div class="name-header-text">{{ selectedPerson.name }}</div>
                  <StatusBadge :status="selectedPerson.status" :vivid="true" />
                </div>
              </div>
              <div class="profile-technical-sheet">
                <div class="sheet-data-node"><span>LAT / LNG</span><strong>{{ selectedPerson.lat?.toFixed(4) }}, {{ selectedPerson.lng?.toFixed(4) }}</strong></div>
                <div class="sheet-data-node"><span>SCAN RADIUS DISTANCE</span><strong>{{ selectedPerson.distance_km?.toFixed(2) }} KM</strong></div>
                <div class="sheet-data-node"><span>UPDATED</span><strong>{{ relativeTime(selectedPerson.updated_at) }}</strong></div>
                <div class="sheet-data-node"><span>COMMS PHONE LINE</span><strong>{{ selectedPerson.phone || 'DISCONNECTED' }}</strong></div>
                <div v-if="selectedPerson.medical_notes" class="medical-directive-alert">
                  <span class="directive-lbl">CRITICAL MEDICAL DIRECTIVES</span>
                  <p class="directive-body">{{ selectedPerson.medical_notes }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="pane-sub-segment separation-border default-pad">
            <div class="pane-header-strip no-bg"><span class="pane-title">ALLOCATION METRIC DISTRIBUTION</span></div>
            <div class="metric-proportion-row">
              <div class="proportional-ring-wrap">
                <svg width="56" height="56" viewBox="0 0 36 36">
                  <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#1f2937" stroke-width="3.5" />
                  <path :stroke-dasharray="`${accountedPct}, 100`" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#00e676" stroke-width="3.5" />
                </svg>
                <span class="percentage-label">{{ accountedPct }}%</span>
              </div>
              <div class="proportional-legend-list">
                <div class="legend-bullet-item"><span class="bullet-dot clear-green"></span> REPLIED ({{ cmdStats.checked_in }})</div>
                <div class="legend-bullet-item"><span class="bullet-dot clear-red"></span> UNACCOUNTED ({{ cmdStats.total - cmdStats.checked_in }})</div>
              </div>
            </div>
          </div>

          <!-- Nearby facilities — scoped to the disaster selected on the
               DISASTERS tab (or all facilities if none selected). -->
          <div class="pane-sub-segment separation-border">
            <div class="pane-header-strip no-bg">
              <span class="pane-title">
                FACILITIES{{ activeDisaster ? ' — ' + activeDisaster.type.toUpperCase() : ' — ALL' }} · {{ shelters.length }}
              </span>
            </div>
            <div class="facility-list">
              <div v-for="s in shelters" :key="s.id" class="facility-row" @click="locateShelter(s)">
                <span class="facility-name">{{ s.name }}</span>
                <span class="facility-meta">{{ s.type }}<template v-if="s.capacity"> · {{ s.capacity }}</template></span>
              </div>
              <div v-if="shelters.length === 0" class="cyber-empty-notice">No facilities in radius.</div>
            </div>
          </div>

          <div class="pane-sub-segment variable-growth-fill">
            <div class="pane-header-strip"><span class="pane-title">EOC REALTIME TRANSMISSION LOGS</span></div>
            <div class="live-stream-logger">
              <div v-for="(a, i) in alerts" :key="i" class="stream-line-node" :class="a.level">
                <span class="line-timestamp">[{{ a.ts }}]</span>
                <span class="line-message-body">{{ a.msg }}</span>
              </div>
              <div v-if="alerts.length === 0" class="stream-empty-prompt">STANDBY // AWAITING EOC INCOMING LOG PACKETS...</div>
            </div>
          </div>

          <div class="pane-bottom-action-dock">
            <button class="btn-system-abort" @click="logout">TERMINATE EOC CONSOLE SESSION</button>
          </div>
        </div>

      </div>

      <!-- Radar maximize overlay -->
      <div v-if="isMaximized" class="radar-overlay" @click.self="isMaximized = false">
        <div class="radar-modal">
          <div class="radar-header">
            <span class="card-caption">RISK RADAR — CURRENT vs GLOBAL</span>
            <button class="radar-max-btn" @click="isMaximized = false" title="Close">✕ Close</button>
          </div>
          <svg class="radar-svg radar-svg-lg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
            <polygon v-for="(ring, i) in radarRings" :key="i" :points="ring" class="radar-ring" />
            <line v-for="ax in radarAxes" :key="ax.label" :x1="RC" :y1="RC" :x2="ax.x2" :y2="ax.y2" class="radar-spoke" />
            <text v-for="ax in radarAxes" :key="ax.label + '-l'" :x="ax.lx" :y="ax.ly" class="radar-label">{{ ax.label }}</text>
            <polygon :points="radarBaseline" class="radar-baseline" />
            <polygon :points="radarCurrent" class="radar-current" />
          </svg>
          <div class="radar-legend">
            <span><i class="sw-current"></i> CURRENT DISASTER</span>
            <span><i class="sw-baseline"></i> GLOBAL BASELINE</span>
          </div>
        </div>
      </div>
  </div>
</template>

<style scoped>
/* ── Light EOC Theme Core Styles ── */
.dashboard-root-dark {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #f3f4f6;
  color: #374151;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
  box-sizing: border-box;
  padding: 10px;
  gap: 10px;
}

/* Auth — same design as the Admin console login (see AdminView.vue) */
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

.text-red { color: #dc2626; }
.text-orange { color: #ea580c; }
.text-yellow { color: #d97706; }

/* ── Dashboard Grid Structure ── */
.dashboard-grid-workspace { display: grid; grid-template-columns: 310px 1fr 320px; gap: 10px; flex: 1; min-height: 0; }
.pane-column { background: #ffffff; border-radius: 4px; border: 1px solid #e5e7eb; display: flex; flex-direction: column; overflow: hidden; }
.pane-header-strip { padding: 10px 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
.pane-title { font-size: 11px; font-weight: bold; color: #16335a; }

/* ── Navigation Strip ── */
.pane-navigation-tabs { display: flex; background: #f9fafb; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
.pane-navigation-tabs button { flex: 1; padding: 8px 2px; font-size: 10px; font-weight: bold; background: transparent; border: none; border-bottom: 2px solid transparent; color: #6b7280; cursor: pointer; font-family: inherit; }
.pane-navigation-tabs button.active { color: #1f4e87; border-bottom-color: #1f4e87; background: #ffffff; }

.pane-inner-scroller { flex: 1; overflow-y: auto; padding: 10px; }
.sub-wrapper { display: flex; flex-direction: column; gap: 8px; }

/* Status filter chips */
.filter-chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
.filter-chip { font-size: 9px; font-weight: bold; padding: 3px 6px; border-radius: 3px; background: #fff; border: 1px solid #d1d5db; color: #9ca3af; cursor: pointer; font-family: inherit; }
.filter-chip.on { background: #f3f4f6; color: #374151; border-color: #9ca3af; }

/* ── Triage Queue Stack ── */
.cyber-queue-stack { display: flex; flex-direction: column; gap: 10px; }
.queue-category { display: flex; flex-direction: column; gap: 4px; }
.category-divider { font-size: 10px; font-weight: bold; padding-bottom: 3px; border-bottom: 1px dashed #d1d5db; margin-bottom: 2px; }
.cyber-queue-item { background: #fff; border: 1px solid #e5e7eb; padding: 4px; border-radius: 2px; cursor: pointer; }
.cyber-empty-notice { padding: 16px; text-align: center; color: #9ca3af; font-size: 11px; }

/* ── Primary Map Content Core Layout ── */
.center-workspace-pane { display: flex; flex-direction: column; }
.gis-map-viewport { flex: 1; min-height: 0; position: relative; background: #e5e7eb; }
.map-scope-toggle { position: absolute; top: 10px; right: 10px; z-index: 1000; display: flex; background: #fff; border-radius: 4px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
.map-scope-toggle button { font-size: 10px; font-weight: bold; padding: 6px 10px; background: #fff; border: none; color: #6b7280; cursor: pointer; font-family: inherit; }
.map-scope-toggle button.active { background: #1f4e87; color: #fff; }
.pane-analytics-dock { height: 125px; border-top: 1px solid #e5e7eb; display: flex; background: #ffffff; flex-shrink: 0; }
.dock-half { flex: 0 0 50%; max-width: 50%; padding: 10px; display: flex; flex-direction: column; gap: 6px; overflow: hidden; box-sizing: border-box; }
.dock-half:first-child { border-right: 1px solid #e5e7eb; }
.card-caption { font-size: 9px; font-weight: bold; color: #6b7280; }

/* ── Radar chart ── */
.radar-half { gap: 2px; }
.radar-header { display: flex; align-items: center; justify-content: space-between; }
.radar-max-btn { font-size: 9px; font-weight: bold; padding: 2px 6px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 3px; color: #374151; cursor: pointer; font-family: inherit; }
.radar-max-btn:hover { background: #e5e7eb; }
.radar-svg { flex: 1; min-height: 0; width: 100%; }
.radar-ring { fill: none; stroke: #e5e7eb; stroke-width: 0.6; }
.radar-spoke { stroke: #e5e7eb; stroke-width: 0.6; }
.radar-baseline { fill: rgba(156,163,175,0.25); stroke: rgba(156,163,175,0.6); stroke-width: 1; }
.radar-current { fill: rgba(31,78,135,0.25); stroke: #1f4e87; stroke-width: 1.5; }
.radar-label { font-size: 7px; font-weight: bold; fill: #6b7280; text-anchor: middle; dominant-baseline: middle; }

/* Radar maximize overlay */
.radar-overlay { position: fixed; inset: 0; background: rgba(17,24,39,0.55); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.radar-modal { background: #fff; border-radius: 6px; padding: 16px; width: min(560px, 90vw); box-shadow: 0 12px 40px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 8px; }
.radar-svg-lg { height: 440px; }
.radar-legend { display: flex; gap: 18px; font-size: 10px; font-weight: bold; color: #374151; justify-content: center; }
.radar-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.radar-legend .sw-current { background: rgba(31,78,135,0.25); border: 1.5px solid #1f4e87; }
.radar-legend .sw-baseline { background: rgba(156,163,175,0.25); border: 1px solid rgba(156,163,175,0.6); }

/* Real status distribution bar */
.dist-bar { display: flex; height: 14px; border-radius: 3px; overflow: hidden; background: #f3f4f6; }
.dist-seg { height: 100%; flex-shrink: 0; }
.dist-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 8px; color: #6b7280; }
.dist-legend-item { display: flex; align-items: center; gap: 3px; }
.dist-legend-item i { width: 6px; height: 6px; border-radius: 1px; display: inline-block; }

/* Priority load bars */

/* ── Right Panel Information Elements ── */
.pane-sub-segment { display: flex; flex-direction: column; flex-shrink: 0; }
.variable-growth-fill { flex: 1; min-height: 0; }
.separation-border { border-bottom: 1px solid #e5e7eb; }
.default-pad { padding-bottom: 10px; }
.inspector-profile-card { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.profile-summary-row { display: flex; gap: 8px; align-items: center; }
.name-header-text { font-size: 13px; font-weight: bold; color: #111827; }
.profile-technical-sheet { display: flex; flex-direction: column; gap: 5px; }
.sheet-data-node { display: flex; justify-content: space-between; font-size: 11px; gap: 8px; }
.sheet-data-node span { color: #6b7280; }
.sheet-data-node strong { color: #111827; text-align: right; }
.medical-directive-alert { background: #fef2f2; border: 1px solid #fecaca; padding: 6px; border-radius: 3px; margin-top: 4px; }
.directive-lbl { font-size: 9px; font-weight: bold; color: #dc2626; display: block; }
.directive-body { font-size: 11px; color: #111827; margin: 2px 0 0 0; }

/* Proportion ring */
.metric-proportion-row { display: flex; align-items: center; gap: 14px; padding: 8px 12px 0; }
.proportional-ring-wrap { position: relative; display: inline-flex; }
.percentage-label { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 9px; font-weight: bold; color: #111827; }
.proportional-legend-list { display: flex; flex-direction: column; gap: 4px; font-size: 9px; font-weight: bold; color: #374151; }
.bullet-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 4px; }
.clear-green { background: #16a34a; } .clear-red { background: #dc2626; }

/* Facilities */
.facility-list { max-height: 110px; overflow-y: auto; }
.facility-row { display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-bottom: 1px solid #f3f4f6; font-size: 11px; cursor: pointer; }
.facility-row:hover { background: #f3f4f6; }
.facility-name { color: #374151; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facility-meta { color: #9ca3af; font-size: 9px; flex-shrink: 0; }

/* Realtime Logging */
.live-stream-logger { flex: 1; overflow-y: auto; padding: 8px 12px; display: flex; flex-direction: column; gap: 5px; background: #f9fafb; }
.stream-line-node { font-size: 10px; line-height: 1.3; display: flex; gap: 6px; border-bottom: 1px solid #eef0f3; padding-bottom: 2px; }
.line-timestamp { color: #9ca3af; flex-shrink: 0; }
.line-message-body { color: #374151; }
.stream-line-node.critical .line-message-body { color: #dc2626; font-weight: bold; }
.stream-line-node.warn .line-message-body { color: #d97706; }
.stream-empty-prompt { color: #9ca3af; font-size: 10px; }

/* Forms */
.cyber-form-layout { display: flex; flex-direction: column; gap: 8px; }
.form-title { font-size: 10px; font-weight: bold; color: #6b7280; letter-spacing: 0.02em; }
.field-wrap { display: flex; flex-direction: column; gap: 3px; }
.field-wrap label { font-size: 9px; color: #6b7280; font-weight: bold; }
.cyber-select, .cyber-field { background: #fff; border: 1px solid #d1d5db; padding: 5px; border-radius: 3px; color: #111827; font-family: inherit; font-size: 11px; }
.field-row-split { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.cyber-btn-bright { background: #1f4e87; color: #fff; border: none; padding: 6px; border-radius: 3px; font-weight: bold; cursor: pointer; font-family: inherit; font-size: 11px; }
.cyber-btn-dim { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; padding: 5px; border-radius: 3px; font-size: 10px; cursor: pointer; font-family: inherit; }
.form-feedback-banner { font-size: 11px; padding: 5px; border-radius: 3px; background: #f3f4f6; }
.form-feedback-banner.error { color: #dc2626; }
.form-feedback-banner.warn { color: #d97706; }
.range-box { display: flex; flex-direction: column; gap: 4px; }
.range-labels { display: flex; justify-content: space-between; font-size: 10px; color: #6b7280; }
.cyber-slider { width: 100%; }
.topology-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.topology-checkbox-item { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #6b7280; cursor: pointer; }
.topology-checkbox-item input[type="checkbox"] { accent-color: #1f4e87; }
.pane-bottom-action-dock { padding: 8px; border-top: 1px solid #e5e7eb; background: #f9fafb; }
.btn-system-abort { width: 100%; padding: 6px; color: #6b7280; background: transparent; border: 1px solid #e5e7eb; border-radius: 3px; font-size: 10px; font-weight: bold; cursor: pointer; font-family: inherit; }
.btn-system-abort:hover { color: #dc2626; background: #fef2f2; border-color: #fecaca; }
.pane-badge-status { background: #f3f4f6; color: #6b7280; font-size: 8px; padding: 1px 4px; border-radius: 2px; font-weight: bold; }
.pane-badge-status.scanning { color: #d97706; }
.cyber-list-row { padding: 6px; border-bottom: 1px solid #e5e7eb; cursor: pointer; background: #fff; }
.cyber-list-row.active { border-left: 2px solid #1f4e87; background: #eff6ff; }
.row-flex-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #111827; }
.row-flex-desc { font-size: 10px; color: #6b7280; margin-top: 2px; }
.pane-coordinates { font-size: 9px; color: #9ca3af; }
.dismiss-btn { background: transparent; border: none; color: #6b7280; font-size: 16px; cursor: pointer; line-height: 1; }
.no-bg { background: transparent !important; }
</style>
