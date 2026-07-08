<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { getRescueView, getDisasters, getShelters, createIncident, getActiveIncidents, resolveIncident } from '../api.js';
import { GOV_TOKEN_KEY } from '../router/index.js';
import { useSocket } from '../socket.js';
import LeafletMap from '../components/LeafletMap.vue';
import StatusBadge from '../components/StatusBadge.vue';
import GovLogin from '../components/gov/GovLogin.vue';
import TriagePanel from '../components/gov/TriagePanel.vue';
import CommandStats from '../components/gov/CommandStats.vue';
import DispatchPanel from '../components/gov/DispatchPanel.vue';
import AppIcon from '../components/AppIcon.vue';
import { STATUS_SHORT, DISASTER_ICON, severityInfo, genderIcon } from '../iconography.js';

// ── Auth ──────────────────────────────────────────────────────────
const token     = ref(sessionStorage.getItem(GOV_TOKEN_KEY) || '');
const needsAuth = ref(!token.value);
const authError = ref(null);
const authBusy  = ref(false);

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

// ── CFR: responder dispatch (form lives in DispatchPanel) ─────────
const incidents = ref([]);
const cfrBusy   = ref(false);
const cfrMsg    = ref(null);

async function loadIncidents() {
  if (!token.value) return;
  try {
    incidents.value = (await getActiveIncidents(token.value)).incidents || [];
  } catch { /* 401 handled by fetchAll */ }
}

async function dispatchIncident({ type, lat: rawLat, lng: rawLng, is_public }) {
  cfrMsg.value = null;
  const lat = Number(rawLat), lng = Number(rawLng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    cfrMsg.value = { level: 'error', text: 'Enter valid coordinates.' };
    return;
  }
  cfrBusy.value = true;
  try {
    const res = await createIncident({ type, lat, lng, is_public }, token.value);
    if (res.incident === null) {
      cfrMsg.value = { level: 'warn', text: 'Suppressed — an active incident already covers this location.' };
    } else {
      cfrMsg.value = { level: 'info', text: `Dispatched — ${res.matched} responder(s) alerted.` };
      addAlert(`INCIDENT: ${type} dispatched — ${res.matched} responder(s) alerted`, 'critical');
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

let debounceTimer = null;
let refreshTimer  = null;

// ── Computed ──────────────────────────────────────────────────────
const filteredResults = computed(() =>
  allResults.value.filter((r) => statusFilters.value[r.status] ?? true)
);

const p1 = computed(() => filteredResults.value.filter((r) => r.priority === 0));
const p2 = computed(() => filteredResults.value.filter((r) => r.priority === 1));
const p3 = computed(() => filteredResults.value.filter((r) => r.priority >= 2));

// Tally per-status counts — shared by the disaster-scoped and global snapshots.
function countStatuses(list) {
  const c = { need_help: 0, awaiting: 0, pot_missing: 0, missing_only: 0, injured: 0, safe: 0 };
  for (const r of list) {
    switch (r.status) {
      case 'need_help':           c.need_help++; break;
      case 'awaiting_response':   c.awaiting++; break;
      case 'potentially_missing': c.pot_missing++; break;
      case 'missing':             c.missing_only++; break;
      case 'injured':             c.injured++; break;
      case 'safe':                c.safe++; break;
    }
  }
  return c;
}

const cmdStats = computed(() => {
  const c = countStatuses(allResults.value);
  return {
    active_disasters: disasters.value.length,
    total:            allResults.value.length,
    checked_in:       c.safe + c.injured + c.need_help,
    missing:          c.pot_missing + c.missing_only,
    ...c,
  };
});

// Same shape as cmdStats but over allResultsGlobal (fixed wide radius, ignores
// the currently selected disaster) — the "all data" totals.
const cmdStatsGlobal = computed(() => ({
  total: allResultsGlobal.value.length,
  ...countStatuses(allResultsGlobal.value),
}));

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

async function submitToken(tokenValue) {
  authBusy.value  = true;
  authError.value = null;
  try {
    await getRescueView(center.value.lat, center.value.lng, radius.value, tokenValue);
    token.value = tokenValue;
    sessionStorage.setItem(GOV_TOKEN_KEY, token.value);
    needsAuth.value = false;
    await fetchAll();
    addAlert('Authenticated. Live data feed active.', 'info');
  } catch (err) {
    authError.value = err.status === 401
      ? 'Invalid token. Access denied.'
      : 'Could not verify token. Please try again.';
  } finally {
    authBusy.value = false;
  }
}

const leafletMapRef = ref(null);
const triagePanelRef = ref(null);

function onMarkerClick(reportId) {
  highlightId.value    = reportId;
  selectedPersonId.value = reportId;
  activeSection.value  = 'rescue-queue';
  nextTick(() => { triagePanelRef.value?.scrollToReport(reportId); });
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
  if (!token.value && location.hostname === 'localhost') {
    token.value = 'dev-bypass';
    sessionStorage.setItem(GOV_TOKEN_KEY, token.value);
    needsAuth.value = false;
  }
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

// Disaster cards mirror the triage style — the rail + medallion + SEV text are
// coloured by severity (the disaster analog of a triage priority/status colour).
function disasterColor(d) {
  return d?.severity ? severityInfo(d.severity).colorVar : '#8a8b93';
}

// DISASTERS-tab search — matches a disaster's type or description.
const disasterSearch = ref('');
const filteredDisasters = computed(() => {
  const q = disasterSearch.value.trim().toLowerCase();
  if (!q) return disasters.value;
  return disasters.value.filter((d) =>
    (d.type || '').toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q));
});

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
  <GovLogin v-if="needsAuth" :error="authError" :busy="authBusy" @submit="submitToken" />

  <div v-else class="dashboard-root-dark">

      <div class="dashboard-grid-workspace">

        <!-- ── LEFT: Tactical routing ──────────────────────────────── -->
        <div class="pane-column">
          <div class="pane-header-strip">
            <span class="pane-title">ROUTING CONTROL</span>
            <div class="pane-badge-status" :class="{ scanning: loading }">{{ loading ? 'FETCHING' : 'READY' }}</div>
          </div>

          <div class="routing-summary">
            <div class="rsum-item"><span class="rsum-lbl">Incidents</span><span class="rsum-num">{{ incidents.length }}</span></div>
            <div class="rsum-item"><span class="rsum-lbl">Disasters</span><span class="rsum-num">{{ disasters.length }}</span></div>
            <div class="rsum-item"><span class="rsum-lbl">Affected</span><span class="rsum-num">{{ cmdStatsGlobal.total }}</span></div>
          </div>

          <div class="pane-navigation-tabs">
            <button :class="{ active: activeSection === 'rescue-queue' }" :aria-pressed="activeSection === 'rescue-queue'" @click="activeSection = 'rescue-queue'">TRIAGE</button>
            <button :class="{ active: activeSection === 'incidents' }" :aria-pressed="activeSection === 'incidents'" @click="activeSection = 'incidents'">DISASTERS</button>
            <button :class="{ active: activeSection === 'cfr' }" :aria-pressed="activeSection === 'cfr'" @click="activeSection = 'cfr'">DISPATCH</button>
            <button :class="{ active: activeSection === 'tools' }" :aria-pressed="activeSection === 'tools'" @click="activeSection = 'tools'">LAYERS</button>
          </div>

          <div class="pane-inner-scroller">

            <!-- TRIAGE -->
            <TriagePanel
              v-if="activeSection === 'rescue-queue'"
              ref="triagePanelRef"
              :p1="p1"
              :p2="p2"
              :p3="p3"
              :status-filters="statusFilters"
              :highlight-id="highlightId"
              :empty="filteredResults.length === 0"
              @toggle="(key) => (statusFilters[key] = !statusFilters[key])"
              @select="onMarkerClick"
            />

            <!-- DISASTERS -->
            <div v-if="activeSection === 'incidents'" class="sub-wrapper">
              <div class="gov-search">
                <AppIcon name="search" :size="14" />
                <input v-model="disasterSearch" type="search" placeholder="Search disaster name…" aria-label="Search disasters by name" />
              </div>
              <div
                v-for="(d, i) in filteredDisasters" :key="d.id"
                class="cyber-list-row" :class="{ active: activeDisaster?.id === d.id }"
                :style="{ borderLeftColor: activeDisaster?.id === d.id ? '#26262b' : disasterColor(d) }"
                role="button" tabindex="0"
                @click="selectDisaster(d)"
                @keydown.enter.prevent="selectDisaster(d)"
                @keydown.space.prevent="selectDisaster(d)"
              >
                <div class="disaster-rank">{{ String(i + 1).padStart(2, '0') }}</div>
                <span class="disaster-ico"><AppIcon :name="DISASTER_ICON[d.type] || 'warning'" :size="16" /></span>
                <div class="disaster-body">
                  <div class="disaster-title-row">
                    <strong>{{ d.type }}</strong>
                    <span v-if="d.severity" class="disaster-sev" :style="{ color: disasterColor(d) }">SEV {{ d.severity }}</span>
                  </div>
                  <div class="row-flex-desc">{{ d.radius_km }} KM<template v-if="d.description"> · {{ d.description }}</template></div>
                </div>
              </div>
              <div v-if="filteredDisasters.length === 0" class="cyber-empty-notice">No active disasters.</div>
            </div>

            <!-- DISPATCH (CFR) — v-show so the form keeps its entries across tab switches -->
            <DispatchPanel
              v-show="activeSection === 'cfr'"
              :incidents="incidents"
              :busy="cfrBusy"
              :msg="cfrMsg"
              :center="center"
              @dispatch="dispatchIncident"
              @stand-down="standDown"
            />

            <!-- LAYERS / TOOLS -->
            <div v-if="activeSection === 'tools'" class="sub-wrapper">
              <div class="form-title">MAP FILTERS</div>
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
            <span class="pane-title">GEOSPATIAL MAP</span>
            <span class="pane-coordinates">{{ center.lat.toFixed(4) }}°N // {{ center.lng.toFixed(4) }}°E</span>
          </div>

          <div class="gis-map-viewport">
            <div class="map-scope-toggle">
              <button :class="{ active: mapScope === 'all' }" :aria-pressed="mapScope === 'all'" @click="mapScope = 'all'">ALL</button>
              <button :class="{ active: mapScope === 'disaster' }" :aria-pressed="mapScope === 'disaster'" @click="mapScope = 'disaster'">BY DISASTER</button>
            </div>
            <LeafletMap ref="leafletMapRef" :reports="mapReports" :disasters="mapDisasterZones" :shelters="mapShelters" :layers="mapLayers" @markerClick="onMarkerClick" @move="onMapMove" />
          </div>

          <CommandStats :stats="cmdStats" :stats-global="cmdStatsGlobal" />
        </div>

        <!-- ── RIGHT: Inspector + distribution ring + logs ─────────── -->
        <div class="pane-column">

          <div v-if="selectedPerson" class="pane-sub-segment separation-border">
            <div class="pane-header-strip highlight-alert-bg">
              <span class="pane-title">PERSON DETAILS</span>
              <button class="dismiss-btn" aria-label="Close person details" @click="selectedPersonId = null">×</button>
            </div>
            <div class="inspector-profile-card">
              <div class="profile-summary-row">
                <span class="person-ico"><AppIcon :name="genderIcon(selectedPerson.gender)" :size="18" /></span>
                <div>
                  <div class="name-header-text">{{ selectedPerson.name }}</div>
                  <StatusBadge :status="selectedPerson.status" :bare="true" :icon="false" />
                </div>
              </div>
              <div class="profile-technical-sheet">
                <div class="sheet-data-node"><span>LAT / LNG</span><strong>{{ selectedPerson.lat?.toFixed(4) }}, {{ selectedPerson.lng?.toFixed(4) }}</strong></div>
                <div class="sheet-data-node"><span>DISTANCE FROM CENTER</span><strong>{{ selectedPerson.distance_km?.toFixed(2) }} KM</strong></div>
                <div class="sheet-data-node"><span>UPDATED</span><strong>{{ relativeTime(selectedPerson.updated_at) }}</strong></div>
                <div class="sheet-data-node"><span>PHONE</span><strong>{{ selectedPerson.phone || 'NOT PROVIDED' }}</strong></div>
                <div v-if="selectedPerson.medical_notes" class="medical-directive-alert">
                  <span class="directive-lbl">MEDICAL NOTES</span>
                  <p class="directive-body">{{ selectedPerson.medical_notes }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="pane-sub-segment separation-border default-pad">
            <div class="pane-header-strip no-bg"><span class="pane-title">STATUS OVERVIEW</span></div>
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
              <div
                v-for="s in shelters" :key="s.id"
                class="facility-row"
                role="button" tabindex="0"
                @click="locateShelter(s)"
                @keydown.enter.prevent="locateShelter(s)"
                @keydown.space.prevent="locateShelter(s)"
              >
                <span class="facility-name">{{ s.name }}</span>
                <span class="facility-meta">{{ s.type }}<template v-if="s.capacity"> · {{ s.capacity }}</template></span>
              </div>
              <div v-if="shelters.length === 0" class="cyber-empty-notice">No facilities in radius.</div>
            </div>
          </div>

          <div class="pane-sub-segment variable-growth-fill">
            <div class="pane-header-strip"><span class="pane-title">ACTIVITY LOG</span></div>
            <div class="live-stream-logger" role="log" aria-live="polite">
              <div v-for="(a, i) in alerts" :key="i" class="stream-line-node" :class="a.level">
                <span class="line-timestamp">[{{ a.ts }}]</span>
                <span class="line-message-body">{{ a.msg }}</span>
              </div>
              <div v-if="alerts.length === 0" class="stream-empty-prompt">Standby — awaiting activity...</div>
            </div>
          </div>

          <div class="pane-bottom-action-dock">
            <button class="btn-system-abort" @click="logout">SIGN OUT</button>
          </div>
        </div>

      </div>
  </div>
</template>

<style scoped>
* { box-sizing:border-box; transition:none !important; }

/* ── Shell ──────────────────────────────────────────────── */
.dashboard-root-dark { display:flex; flex-direction:column; height:100%; background:#f5f5f6; color:#1e1e22; font-family:var(--font-ui); overflow:hidden; box-sizing:border-box; padding:0; gap:0; }

/* ── Grid ──────────────────────────────────────────────── */
.dashboard-grid-workspace { display:grid; grid-template-columns:310px 1fr 320px; gap:0; flex:1; min-height:0; }
.pane-column { background:#ebecef; border:none; border-right:1px solid #d9dbe0; display:flex; flex-direction:column; overflow:hidden; border-radius:0; }
.pane-column:last-child { border-right:none; border-left:1px solid #d9dbe0; }
.pane-header-strip { padding:12px 14px; background:#ebecef; border-bottom:1px solid #d9dbe0; display:flex; justify-content:space-between; align-items:center; flex-shrink:0; }
.pane-title { font-size:11px; font-weight:700; color:#8a8b93; letter-spacing:0.05em; text-transform:uppercase; }

/* ── Routing-control totals row ─────────────────────────── */
.routing-summary { display:flex; background:#ebecef; border-bottom:1px solid #d9dbe0; flex-shrink:0; }
.rsum-item { flex:1; min-width:0; display:flex; flex-direction:column; padding:8px 12px 10px; border-right:1px solid #d9dbe0; }
.rsum-item:last-child { border-right:none; }
.rsum-lbl { font-size:11px; font-weight:600; color:#8a8b93; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rsum-num { font-size:30px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); line-height:1; text-align:center; margin-top:6px; }

/* ── Navigation ────────────────────────────────────────── */
.pane-navigation-tabs { display:flex; gap:4px; background:#ebecef; border-bottom:1px solid #d9dbe0; flex-shrink:0; padding:6px; }
.pane-navigation-tabs button { flex:1; padding:7px 2px; font-size:12px; font-weight:600; background:transparent; border:none; color:#666; cursor:pointer; font-family:inherit; border-radius:8px; }
.pane-navigation-tabs button:hover { background:#ececee; color:#1e1e22; }
.pane-navigation-tabs button.active { color:#fff; background:#26262b; }

.pane-inner-scroller { flex:1; overflow-y:auto; padding:12px; background:#ebecef; }
.sub-wrapper { display:flex; flex-direction:column; gap:8px; }
.cyber-empty-notice { padding:16px; text-align:center; color:#666; font-size:13px; }

/* ── Map ───────────────────────────────────────────────── */
.center-workspace-pane { display:flex; flex-direction:column; }
.gis-map-viewport { flex:1; min-height:0; position:relative; background:#ececed; }
.map-scope-toggle { position:absolute; top:10px; right:10px; z-index:1000; display:flex; background:#fff; border:1px solid #d9dbe0; overflow:hidden; border-radius:8px; box-shadow:0 1px 4px rgba(0,0,0,0.12); }
.map-scope-toggle button { font-size:12px; font-weight:600; padding:6px 10px; background:#fff; border:none; color:#555; cursor:pointer; font-family:inherit; }
.map-scope-toggle button.active { background:#26262b; color:#fff; }

/* ── Inspector ─────────────────────────────────────────── */
.pane-sub-segment { display:flex; flex-direction:column; flex-shrink:0; }
.variable-growth-fill { flex:1; min-height:0; }
.separation-border { border-bottom:1px solid #d9dbe0; }
.default-pad { padding-bottom:10px; }
.inspector-profile-card { padding:12px; display:flex; flex-direction:column; gap:8px; }
.profile-summary-row { display:flex; gap:10px; align-items:center; }
.person-ico { display:inline-grid; place-items:center; width:32px; height:32px; border-radius:8px; background:#f0f0f2; color:#5b5c63; flex-shrink:0; }
.name-header-text { font-size:14px; font-weight:700; color:#222; }
.profile-technical-sheet { display:flex; flex-direction:column; gap:5px; }
.sheet-data-node { display:flex; justify-content:space-between; font-size:13px; gap:8px; }
.sheet-data-node span { color:#666; }
.sheet-data-node strong { color:#222; text-align:right; }
.medical-directive-alert { background:#fff; border:1px solid #d9dbe0; padding:8px; margin-top:4px; border-radius:8px; }
.directive-lbl { font-size:12px; font-weight:700; color:#333; display:block; }
.directive-body { font-size:13px; color:#222; margin:2px 0 0 0; }

/* ── Metrics ───────────────────────────────────────────── */
.metric-proportion-row { display:flex; align-items:center; gap:14px; padding:8px 12px 0; }
.proportional-ring-wrap { position:relative; display:inline-flex; }
.percentage-label { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:11px; font-weight:700; color:#222; }
.proportional-legend-list { display:flex; flex-direction:column; gap:4px; font-size:12px; font-weight:600; color:#333; }
.bullet-dot { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px; }
.clear-green { background:#16a34a; } .clear-red { background:#dc2626; }

/* ── Facilities ────────────────────────────────────────── */
.facility-list { max-height:110px; overflow-y:auto; }
.facility-row { display:flex; align-items:center; gap:8px; padding:5px 12px; border-bottom:1px solid #d9dbe0; font-size:13px; cursor:pointer; }
.facility-row:hover { background:#e2e3e7; }
.facility-name { color:#222; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.facility-meta { color:#666; font-size:12px; flex-shrink:0; }

/* ── Log ───────────────────────────────────────────────── */
.live-stream-logger { flex:1; overflow-y:auto; padding:8px 12px; display:flex; flex-direction:column; gap:5px; background:transparent; }
.stream-line-node { font-size:12px; line-height:1.3; display:flex; gap:6px; border-bottom:1px solid #d9dbe0; padding-bottom:2px; }
.line-timestamp { color:#666; flex-shrink:0; font-family:var(--font-mono); }
.line-message-body { color:#222; }
.stream-line-node.critical .line-message-body { color:#c0392b; font-weight:700; }
.stream-line-node.warn .line-message-body { color:#9a5f00; font-weight:600; }
.stream-empty-prompt { color:#666; font-size:12px; }

/* ── Forms (LAYERS tab; the dispatch form lives in DispatchPanel) ── */
.form-title { font-size:12px; font-weight:700; color:#555; }
.range-box { display:flex; flex-direction:column; gap:4px; }
.range-labels { display:flex; justify-content:space-between; font-size:12px; color:#888; }
.cyber-slider { width:100%; }
.topology-grid { display:grid; grid-template-columns:1fr 1fr; gap:5px; }
.topology-checkbox-item { display:flex; align-items:center; gap:5px; font-size:12px; color:#555; cursor:pointer; }
.topology-checkbox-item input[type="checkbox"] { accent-color:#26262b; }
.pane-bottom-action-dock { padding:10px; border-top:1px solid #d9dbe0; background:#ebecef; }
.btn-system-abort { width:100%; padding:8px; color:#555; background:transparent; border:1px solid #d9dbe0; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; border-radius:8px; }
.btn-system-abort:hover { color:#222; background:#e8e8e8; border-color:#999; }
.pane-badge-status { display:inline-flex; align-items:center; gap:6px; background:#e6f6ec; color:#1a7a3f; font-size:11px; padding:3px 10px 3px 8px; font-weight:700; border-radius:999px; }
.pane-badge-status::before { content:''; width:6px; height:6px; border-radius:50%; background:#1a7a3f; flex-shrink:0; animation:readyPulse 1.6s ease-in-out infinite; }
.pane-badge-status.scanning { background:#fff4e0; color:#9a5f00; }
.pane-badge-status.scanning::before { background:#9a5f00; animation:none; }
@keyframes readyPulse { 0% { box-shadow:0 0 0 0 rgba(26,122,63,0.5); } 70% { box-shadow:0 0 0 5px rgba(26,122,63,0); } 100% { box-shadow:0 0 0 0 rgba(26,122,63,0); } }
@media (prefers-reduced-motion: reduce) { .pane-badge-status::before { animation:none; } }
.cyber-list-row { display:flex; align-items:flex-start; gap:8px; padding:8px 12px; border:1px solid #d9dbe0; border-left:3px solid transparent; border-radius:10px; cursor:pointer; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,0.03); }
.cyber-list-row:hover { border-color:#c4c4ca; }
.cyber-list-row.active { border-color:#26262b; background:#fafafb; }
.disaster-rank { font-family:var(--font-mono); font-size:12px; font-weight:700; color:#9a9ba3; width:22px; text-align:right; padding-top:1px; flex-shrink:0; }
.disaster-ico { display:inline-grid; place-items:center; width:28px; height:28px; border-radius:6px; background:#f0f0f2; color:#5b5c63; flex-shrink:0; margin-top:1px; }
.disaster-body { flex:1; min-width:0; }
.disaster-title-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.disaster-title-row strong { font-size:13px; font-weight:700; color:#1e1e22; text-transform:capitalize; }
.disaster-sev { font-size:11px; font-weight:700; color:#c0392b; letter-spacing:0.02em; }
.row-flex-meta { display:flex; justify-content:space-between; align-items:center; font-size:13px; color:#222; }
.row-flex-desc { font-size:12px; color:#8a8b93; margin-top:3px; }
.pane-coordinates { font-size:11px; color:#666; font-family:var(--font-mono); }
.dismiss-btn { background:transparent; border:none; color:#666; font-size:16px; cursor:pointer; line-height:1; }
.no-bg { background:transparent !important; }
</style>
