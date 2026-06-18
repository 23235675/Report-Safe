<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { getRescueView, getDisasters, getShelters } from '../api.js';
import { GOV_TOKEN_KEY } from '../router/index.js';
import { useSocket } from '../socket.js';
import TriageRow from '../components/TriageRow.vue';
import LeafletMap from '../components/LeafletMap.vue';
import AppIcon from '../components/AppIcon.vue';
import StatusIcon from '../components/StatusIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import VisibilityChip from '../components/VisibilityChip.vue';
import { DISASTER_ICON, SHELTER_ICON, STATUS_SHORT, STATUS_COLOR, statusIcon } from '../iconography.js';

const route = useRoute();

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
const disasters   = ref([]);
const shelters    = ref([]);
const loading     = ref(false);
const highlightId = ref(null);
const selectedPersonId = ref(null);

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

// ── Real-time ─────────────────────────────────────────────────────
const { onStatsUpdate, onDisasterAlert, onMissingAlert } = useSocket();
let offStats = null, offAlert = null, offMissing = null;

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
  return {
    active_disasters: disasters.value.length,
    total:            all.length,
    checked_in:       all.filter((r) => ['safe', 'injured', 'need_help'].includes(r.status)).length,
    need_help:        all.filter((r) => r.status === 'need_help').length,
    awaiting:         all.filter((r) => r.status === 'awaiting_response').length,
    missing:          all.filter((r) => ['potentially_missing', 'missing'].includes(r.status)).length,
    pot_missing:      all.filter((r) => r.status === 'potentially_missing').length,
    missing_only:     all.filter((r) => r.status === 'missing').length,
    injured:          all.filter((r) => r.status === 'injured').length,
    safe:             all.filter((r) => r.status === 'safe').length,
  };
});

const selectedDisasterId = ref(null);
const activeDisaster = computed(() => {
  if (selectedDisasterId.value) return disasters.value.find((d) => d.id === selectedDisasterId.value) || null;
  return disasters.value[0] || null;
});

const mapDisasterOverlay = computed(() =>
  activeDisaster.value
    ? { lat: activeDisaster.value.lat, lng: activeDisaster.value.lng, radius_km: activeDisaster.value.radius_km, type: activeDisaster.value.type }
    : null
);

const mapReports = computed(() =>
  allResults.value.filter((r) => mapLayers.value[r.status] ?? true)
);

const mapShelters = computed(() =>
  shelters.value.filter((s) => {
    if (s.type === 'hospital' || s.type === 'clinic') return mapLayers.value.hospitals;
    return mapLayers.value.shelters;
  })
);

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
    const [rescueRes, disasterRes, shelterRes] = await Promise.all([
      getRescueView(lat, lng, r, token.value),
      getDisasters(),
      getShelters(lat, lng, r * 2),
    ]);
    allResults.value = rescueRes.results   || [];
    disasters.value  = disasterRes.disasters || [];
    shelters.value   = shelterRes.shelters  || [];
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

function onRadiusInput() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fetchAll, 500);
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

function onMarkerClick(reportId) {
  highlightId.value    = reportId;
  selectedPersonId.value = reportId;
  activeSection.value  = 'rescue-queue';
  nextTick(() => {
    const el     = document.getElementById(`triage-${reportId}`);
    const scroll = triageScrollEl.value;
    if (el && scroll) scroll.scrollTop = el.offsetTop - scroll.clientHeight / 2;
  });
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

  offStats  = onStatsUpdate(() => { /* stats come via fetchAll polling */ });
  offAlert  = onDisasterAlert((d) => {
    if (!disasters.value.find((x) => x.id === d.id)) disasters.value = [d, ...disasters.value];
    addAlert(`ALERT: ${d.type.toUpperCase()} detected — ${d.description || d.radius_km + 'km radius'}`, 'critical');
  });
  offMissing = onMissingAlert((payload) => {
    addAlert(`${payload.ids.length} report(s) escalated to Potentially Missing`, 'warn');
    fetchAll();
  });
});

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (refreshTimer)  clearInterval(refreshTimer);
  offStats?.();
  offAlert?.();
  offMissing?.();
});

// ── Display helpers ───────────────────────────────────────────────
// Use the canonical short labels from iconography.js (single source of truth).
const STATUS_LABEL = STATUS_SHORT;

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
function relativeTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const statusColorMap = STATUS_COLOR;
function personStatusColor(s) { return statusColorMap[s] || 'var(--missing)'; }

function disasterIcon(type) { return DISASTER_ICON[type?.toLowerCase()] || 'warning'; }
function shelterTypeIcon(type) { return SHELTER_ICON[type] || 'business'; }
function alertIcon(level) {
  return level === 'critical' ? 'alert-circle' : level === 'warn' ? 'help-circle' : 'information-circle';
}

// Status legend — the operational key, so the map's colours are learnable.
const LEGEND = [
  { key: 'need_help',           label: 'Need Help' },
  { key: 'injured',             label: 'Injured' },
  { key: 'awaiting_response',   label: 'Awaiting' },
  { key: 'potentially_missing', label: 'Pot. Missing' },
  { key: 'missing',             label: 'Missing' },
  { key: 'safe',                label: 'Safe' },
];
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%;">

    <!-- ── Auth Gate ─────────────────────────────────────────────── -->
    <div v-if="needsAuth" class="modal-overlay">
      <form class="modal" @submit.prevent="submitToken">
        <div class="modal-brand">
          <div class="modal-brand-icon">報</div>
          <div>
            <div style="font-size: 14px; font-weight: 700; color: var(--brand);">Report Safe EOC</div>
            <div style="font-size: 12px; color: var(--text-lo);">Government Operations Dashboard</div>
          </div>
        </div>
        <h2>Secure Access Required</h2>
        <p class="modal-sub">
          Enter your government access token to unlock the Emergency Operations Center dashboard.
        </p>
        <div class="field">
          <label for="gov-token">Access Token</label>
          <input id="gov-token" v-model="passwordInput" type="password" placeholder="GOV-SECRET-..." autofocus />
        </div>
        <div v-if="authError" class="msg msg-error" style="margin-top: 0; margin-bottom: var(--sp-4);">
          {{ authError }}
        </div>
        <button type="submit" :disabled="authBusy" style="width: 100%; gap: 6px;">
          <AppIcon v-if="!authBusy" name="lock-closed" :size="15" />
          {{ authBusy ? 'Verifying...' : 'Access Dashboard' }}
        </button>
      </form>
    </div>

    <template v-if="!needsAuth">

      <!-- ── Top Command Bar ────────────────────────────────────────── -->
      <div class="eoc-command-bar">
        <!-- Brand mark inside command bar -->
        <div class="eoc-cmd-brand">
          <div class="eoc-cmd-brand-icon">報</div>
          <div>
            <div class="eoc-cmd-brand-text">Report Safe EOC</div>
            <div class="eoc-cmd-brand-sub">Operations Dashboard</div>
          </div>
        </div>

        <div class="eoc-cmd-cell critical">
          <div class="eoc-cmd-value">{{ cmdStats.active_disasters }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="pulse" :size="12" /> Active Disasters</div>
        </div>
        <div class="eoc-cmd-cell">
          <div class="eoc-cmd-value">{{ cmdStats.total }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="list" :size="12" /> Total Reports</div>
        </div>
        <div class="eoc-cmd-cell safe">
          <div class="eoc-cmd-value">{{ cmdStats.checked_in }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="checkmark-circle" :size="12" /> Checked In</div>
        </div>
        <div class="eoc-cmd-cell critical">
          <div class="eoc-cmd-value">{{ cmdStats.need_help }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="alert-circle" :size="12" /> Need Help</div>
        </div>
        <div class="eoc-cmd-cell warn">
          <div class="eoc-cmd-value">{{ cmdStats.injured }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="medkit" :size="12" /> Injured</div>
        </div>
        <div class="eoc-cmd-cell orange">
          <div class="eoc-cmd-value">{{ cmdStats.awaiting }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="help-circle" :size="12" /> Awaiting</div>
        </div>
        <div class="eoc-cmd-cell rose">
          <div class="eoc-cmd-value">{{ cmdStats.pot_missing }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="search" :size="12" /> Pot. Missing</div>
        </div>
        <div class="eoc-cmd-cell gray">
          <div class="eoc-cmd-value">{{ cmdStats.missing_only }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="person-remove" :size="12" /> Missing</div>
        </div>
        <div class="eoc-cmd-cell safe">
          <div class="eoc-cmd-value">{{ cmdStats.safe }}</div>
          <div class="eoc-cmd-label cmd-line"><AppIcon name="checkmark-circle" :size="12" /> Safe</div>
        </div>
        <!-- Live / refresh indicator -->
        <div class="eoc-cmd-cell" style="margin-left: auto; border-left: 1px solid var(--border-line);">
          <div class="eoc-cmd-value" style="font-size: 13px;">
            <span v-if="loading" class="cmd-line" style="color: var(--awaiting);"><AppIcon name="refresh" :size="14" /> Updating</span>
            <span v-else class="cmd-line" style="color: var(--safe);"><AppIcon name="wifi" :size="14" /> Live</span>
          </div>
          <div class="eoc-cmd-label">Refresh 15s</div>
        </div>
        <!-- Logout -->
        <div class="eoc-cmd-cell" style="padding-right: var(--sp-3);">
          <button
            class="btn-ghost btn-sm"
            @click="logout"
            style="height: 28px; font-size: 11px; gap: 4px;"
          ><AppIcon name="log-out" :size="13" /> Sign Out</button>
        </div>
      </div>

      <!-- ── Three-Panel EOC Layout ─────────────────────────────────── -->
      <div class="eoc-layout">

        <!-- ── LEFT: Sidebar + Priority Queue ───────────────────────── -->
        <div class="eoc-left">

          <!-- Sidebar Navigation -->
          <div class="eoc-sidebar-nav">
            <div class="eoc-nav-section-label">Operations</div>
            <button
              class="eoc-nav-item"
              :class="{ active: activeSection === 'incidents' }"
              @click="activeSection = 'incidents'"
            >
              <span class="nav-icon"><AppIcon name="pulse" :size="16" /></span>
              Active Incidents
              <span v-if="disasters.length > 0" class="nav-count">{{ disasters.length }}</span>
            </button>
            <button
              class="eoc-nav-item"
              :class="{ active: activeSection === 'rescue-queue' }"
              @click="activeSection = 'rescue-queue'"
            >
              <span class="nav-icon"><AppIcon name="alert-circle" :size="16" /></span>
              Rescue Queue
              <span v-if="p1.length > 0" class="nav-count">{{ p1.length }}</span>
            </button>
            <button
              class="eoc-nav-item"
              :class="{ active: activeSection === 'missing' }"
              @click="activeSection = 'missing'"
            >
              <span class="nav-icon"><AppIcon name="person-remove" :size="16" /></span>
              Missing Persons
              <span v-if="cmdStats.missing > 0" class="nav-count">{{ cmdStats.missing }}</span>
            </button>

            <div class="eoc-nav-section-label" style="margin-top: var(--sp-2);">Tools</div>
            <button
              class="eoc-nav-item"
              :class="{ active: activeSection === 'filters' }"
              @click="activeSection = 'filters'"
            >
              <span class="nav-icon"><AppIcon name="funnel" :size="16" /></span>
              Filters &amp; Radius
            </button>
            <button
              class="eoc-nav-item"
              :class="{ active: activeSection === 'layers' }"
              @click="activeSection = 'layers'"
            >
              <span class="nav-icon"><AppIcon name="layers" :size="16" /></span>
              Map Layers
            </button>
          </div>

          <!-- Dynamic content below nav -->

          <!-- INCIDENTS section -->
          <template v-if="activeSection === 'incidents'">
            <div class="eoc-section-hdr">
              <span class="inline-ico"><AppIcon name="pulse" :size="13" /> Active Incidents</span>
              <span class="count">{{ disasters.length }}</span>
            </div>
            <div style="flex: 1; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border-line) transparent;">
              <div
                v-for="d in disasters"
                :key="d.id"
                class="eoc-disaster-row"
                :class="{ active: activeDisaster && activeDisaster.id === d.id }"
                @click="selectDisaster(d)"
              >
                <div class="eoc-disaster-type">
                  <AppIcon :name="disasterIcon(d.type)" :size="14" />
                  {{ d.type }}
                  <span class="eoc-disaster-meta" v-if="d.magnitude">M{{ d.magnitude }}</span>
                  <span class="eoc-disaster-meta">{{ d.radius_km }}km</span>
                </div>
                <div class="eoc-disaster-desc">{{ d.description }}</div>
              </div>
              <div v-if="disasters.length === 0" style="padding: var(--sp-5); text-align: center; color: var(--text-lo); font-size: 13px;">
                No active disasters
              </div>
            </div>
          </template>

          <!-- RESCUE QUEUE section -->
          <template v-if="activeSection === 'rescue-queue'">
            <div class="eoc-section-hdr">
              <span class="inline-ico"><AppIcon name="alert-circle" :size="13" /> Priority Queue</span>
              <span class="count">{{ filteredResults.length }}</span>
              <VisibilityChip tier="rescue" short style="margin-left: auto;" />
            </div>

            <!-- Always-visible status filter (so triage filtering isn't hidden behind a tab) -->
            <div class="eoc-quickfilter">
              <button
                v-for="(on, key) in statusFilters"
                :key="key"
                class="qf-chip"
                :class="{ on }"
                :style="on ? { color: statusColorMap[key], borderColor: statusColorMap[key], background: 'var(--bg-panel)' } : {}"
                :aria-pressed="on"
                @click="statusFilters[key] = !statusFilters[key]"
              >
                <AppIcon :name="statusIcon(key)" :size="12" /> {{ STATUS_LABEL[key] }}
              </button>
            </div>

            <div ref="triageScrollEl" class="eoc-scroll">
              <!-- P1 Critical -->
              <div v-if="p1.length > 0" class="eoc-priority-section">
                <div class="eoc-priority-hdr">
                  <span class="priority-badge priority-p1">P1</span>
                  <span style="color: var(--need-help); font-weight: 700;">Critical Rescue</span>
                  <span style="margin-left: auto;">{{ p1.length }}</span>
                </div>
                <div v-for="(r, i) in p1" :id="`triage-${r.id}`" :key="r.id">
                  <TriageRow :report="r" :index="i" :highlight="highlightId === r.id" />
                </div>
              </div>

              <!-- P2 Urgent -->
              <div v-if="p2.length > 0" class="eoc-priority-section">
                <div class="eoc-priority-hdr">
                  <span class="priority-badge priority-p2">P2</span>
                  <span style="color: var(--injured); font-weight: 700;">Urgent Medical</span>
                  <span style="margin-left: auto;">{{ p2.length }}</span>
                </div>
                <div v-for="(r, i) in p2" :id="`triage-${r.id}`" :key="r.id">
                  <TriageRow :report="r" :index="p1.length + i" :highlight="highlightId === r.id" />
                </div>
              </div>

              <!-- P3 Monitor -->
              <div v-if="p3.length > 0" class="eoc-priority-section">
                <div class="eoc-priority-hdr">
                  <span class="priority-badge priority-p3">P3</span>
                  <span style="color: var(--awaiting); font-weight: 700;">Monitor / Welfare Check</span>
                  <span style="margin-left: auto;">{{ p3.length }}</span>
                </div>
                <div v-for="(r, i) in p3" :id="`triage-${r.id}`" :key="r.id">
                  <TriageRow :report="r" :index="p1.length + p2.length + i" :highlight="highlightId === r.id" />
                </div>
              </div>

              <div v-if="filteredResults.length === 0" style="padding: var(--sp-5); text-align: center; color: var(--text-lo); font-size: 13px;">
                No matching reports in this radius.
              </div>
            </div>
          </template>

          <!-- MISSING PERSONS section -->
          <template v-if="activeSection === 'missing'">
            <div class="eoc-section-hdr">
              <span class="inline-ico"><AppIcon name="person-remove" :size="13" /> Missing Persons</span>
              <span class="count">{{ cmdStats.missing }}</span>
            </div>
            <div class="eoc-scroll">
              <div
                v-for="r in allResults.filter(x => ['potentially_missing','missing'].includes(x.status))"
                :key="r.id"
                class="triage-row"
                :class="highlightId === r.id ? 'highlight' : ''"
                @click="onMarkerClick(r.id)"
              >
                <StatusIcon :status="r.status" :size="28" :icon="16" />
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 13px; font-weight: 700; color: var(--text-hi);">{{ r.name }}</div>
                  <div style="font-size: 11px; color: var(--text-lo); margin-top: 2px;">
                    <span :style="{ color: statusColorMap[r.status] || 'var(--missing)' }">
                      {{ r.status === 'potentially_missing' ? 'Potentially Missing' : 'Missing' }}
                    </span>
                    · {{ relativeTime(r.updated_at) }}
                  </div>
                </div>
              </div>
              <div
                v-if="allResults.filter(x => ['potentially_missing','missing'].includes(x.status)).length === 0"
                style="padding: var(--sp-5); text-align: center; color: var(--text-lo); font-size: 13px;"
              >
                No missing persons in this radius
              </div>
            </div>
          </template>

          <!-- FILTERS section -->
          <template v-if="activeSection === 'filters'">
            <div class="eoc-section-hdr"><span class="inline-ico"><AppIcon name="funnel" :size="13" /> Status Filters</span></div>
            <div class="eoc-filter-bar" style="flex-direction: column; align-items: flex-start; gap: var(--sp-2); padding: var(--sp-4);">
              <label v-for="(on, key) in statusFilters" :key="key" style="display: flex; align-items: center; gap: var(--sp-2);">
                <input type="checkbox" v-model="statusFilters[key]" />
                <span class="inline-ico" :style="{ color: STATUS_COLOR[key], fontWeight: 600 }">
                  <AppIcon :name="statusIcon(key)" :size="14" /> {{ STATUS_LABEL[key] }}
                </span>
              </label>
            </div>
            <div class="eoc-section-hdr"><span class="inline-ico"><AppIcon name="resize" :size="13" /> Search Radius</span></div>
            <div class="radius-ctrl" style="padding: var(--sp-4); flex-direction: column; align-items: flex-start; gap: var(--sp-3);">
              <div class="radius-label">
                Radius: <span class="radius-value">{{ radius }} km</span>
              </div>
              <input v-model.number="radius" type="range" min="1" max="100" @input="onRadiusInput" style="width: 100%;" />
            </div>
          </template>

          <!-- LAYERS section -->
          <template v-if="activeSection === 'layers'">
            <div class="eoc-section-hdr"><span class="inline-ico"><AppIcon name="layers" :size="13" /> Map Layers</span></div>
            <div style="padding: var(--sp-4); display: flex; flex-direction: column; gap: var(--sp-2);">
              <label v-for="(on, key) in mapLayers" :key="key" style="display: flex; align-items: center; gap: var(--sp-2); font-size: 13px; font-weight: 500; color: var(--text-md); cursor: pointer; text-transform: none; letter-spacing: 0; margin: 0;">
                <input type="checkbox" v-model="mapLayers[key]" />
                <span class="inline-ico" :style="{ color: STATUS_COLOR[key] || 'var(--gov-blue)' }">
                  <AppIcon :name="key === 'shelters' ? 'home' : key === 'hospitals' ? 'medkit' : statusIcon(key)" :size="14" />
                  {{ STATUS_LABEL[key] || (key === 'shelters' ? 'Shelters' : 'Hospitals') }}
                </span>
              </label>
            </div>
          </template>

        </div>

        <!-- ── CENTER: GIS Map ───────────────────────────────────────── -->
        <div class="eoc-center">
          <div class="eoc-section-hdr">
            <span class="inline-ico"><AppIcon name="map" :size="13" /> Operational Map</span>
            <span style="margin-left: 4px; color: var(--text-lo); font-size: 10px; font-weight: 400;">
              {{ center.lat.toFixed(4) }}, {{ center.lng.toFixed(4) }}
            </span>
            <span v-if="activeDisaster" class="inline-ico" style="margin-left: var(--sp-2); font-size: 10px; color: var(--need-help); font-weight: 600;">
              <AppIcon :name="disasterIcon(activeDisaster.type)" :size="12" />
              {{ activeDisaster.type }} Active
            </span>
            <span class="hint">Click a marker for person details</span>
          </div>

          <!-- Status legend: the operational key for the map's colours -->
          <div class="eoc-map-legend legend">
            <span
              v-for="l in LEGEND"
              :key="l.key"
              class="legend-item"
              :style="{ color: statusColorMap[l.key] || 'var(--missing)' }"
            >
              <AppIcon :name="statusIcon(l.key)" :size="13" />
              {{ l.label }}
            </span>
            <span class="legend-item" style="color: var(--gov-blue); margin-left: auto;">
              <AppIcon name="home" :size="13" /> Shelter
            </span>
            <span class="legend-item" style="color: var(--gov-blue);">
              <AppIcon name="medkit" :size="13" /> Hospital
            </span>
          </div>

          <div class="eoc-map-wrap">
            <LeafletMap
              :reports="mapReports"
              :disaster="mapDisasterOverlay"
              :shelters="mapShelters"
              :layers="mapLayers"
              @markerClick="onMarkerClick"
            />
          </div>
        </div>

        <!-- ── RIGHT: Person Detail + Stats + Alert Log ────────────── -->
        <div class="eoc-right">

          <!-- Selected person detail card -->
          <div v-if="selectedPerson" style="flex-shrink: 0;">
            <div class="eoc-section-hdr">
              <span class="inline-ico"><AppIcon name="person" :size="13" /> Person Details</span>
              <button
                class="btn-ghost"
                style="margin-left: auto; height: 28px; width: 28px; padding: 0;"
                aria-label="Close person details"
                @click="selectedPersonId = null"
              ><AppIcon name="close" :size="14" /></button>
            </div>
            <div class="eoc-person-card">
              <div class="row-medallion" style="margin-bottom: var(--sp-3);">
                <StatusIcon :status="selectedPerson.status" :size="40" :icon="22" />
                <div style="min-width: 0;">
                  <div class="eoc-person-name" style="margin-bottom: 4px;">{{ selectedPerson.name }}</div>
                  <StatusBadge :status="selectedPerson.status" />
                </div>
              </div>

              <!-- Privacy tier: gov sees the exact GPS + medical notes -->
              <VisibilityChip tier="rescue" style="margin-bottom: var(--sp-3);" />

              <div class="eoc-person-row">
                <span class="eoc-person-row-label inline-ico"><AppIcon name="lock-closed" :size="12" /> GPS (exact)</span>
                <span class="eoc-person-row-val">{{ selectedPerson.lat?.toFixed(5) }}, {{ selectedPerson.lng?.toFixed(5) }}</span>
              </div>
              <div class="eoc-person-row">
                <span class="eoc-person-row-label inline-ico"><AppIcon name="navigate" :size="12" /> Distance</span>
                <span class="eoc-person-row-val">{{ selectedPerson.distance_km?.toFixed(2) }} km</span>
              </div>
              <div class="eoc-person-row">
                <span class="eoc-person-row-label inline-ico"><AppIcon name="time" :size="12" /> Updated</span>
                <span class="eoc-person-row-val">{{ relativeTime(selectedPerson.updated_at) }}</span>
              </div>
              <div v-if="selectedPerson.phone" class="eoc-person-row">
                <span class="eoc-person-row-label inline-ico"><AppIcon name="call" :size="12" /> Phone</span>
                <span class="eoc-person-row-val">{{ selectedPerson.phone }}</span>
              </div>
              <div v-if="selectedPerson.reported_by === 'family'" class="eoc-person-row">
                <span class="eoc-person-row-label inline-ico"><AppIcon name="people" :size="12" /> Reported by</span>
                <span class="eoc-person-row-val">{{ selectedPerson.reporter_name || 'Family' }}</span>
              </div>
              <div v-if="selectedPerson.medical_notes" style="margin-top: var(--sp-3);">
                <div class="inline-ico" style="font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-lo); margin-bottom: 4px;"><AppIcon name="medkit" :size="13" style="color: var(--need-help);" /> Medical Notes</div>
                <div style="font-size: 13px; color: var(--need-help); background: var(--need-help-dim); border: 1px solid var(--need-help-border); border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-3); line-height: 1.5;">
                  {{ selectedPerson.medical_notes }}
                </div>
              </div>
              <div v-if="selectedPerson.relay_count > 0" class="eoc-person-row" style="margin-top: var(--sp-2);">
                <span class="eoc-person-row-label inline-ico"><AppIcon name="refresh" :size="12" /> Relayed</span>
                <span class="eoc-person-row-val">{{ selectedPerson.relay_count }}× via mesh</span>
              </div>
            </div>
          </div>

          <!-- Population breakdown -->
          <div class="eoc-section-hdr">
            <span class="inline-ico"><AppIcon name="stats-chart" :size="13" /> Population Status</span>
          </div>
          <div style="flex-shrink: 0;">
            <div class="eoc-stat-row">
              <span class="eoc-stat-label inline-ico"><AppIcon name="list" :size="14" /> Total Reports</span>
              <span class="eoc-stat-value">{{ cmdStats.total }}</span>
            </div>
            <div class="eoc-stat-row" v-for="entry in [
              { label: 'Need Help',         key: 'need_help' },
              { label: 'Injured',           key: 'injured' },
              { label: 'Awaiting Response', key: 'awaiting_response' },
              { label: 'Pot. Missing',      key: 'potentially_missing' },
              { label: 'Missing',           key: 'missing' },
              { label: 'Safe',              key: 'safe' },
            ]" :key="entry.key">
              <span class="eoc-stat-label inline-ico" :style="{ color: STATUS_COLOR[entry.key] }">
                <AppIcon :name="statusIcon(entry.key)" :size="14" /> {{ entry.label }}
              </span>
              <span class="eoc-stat-value" :style="{ color: STATUS_COLOR[entry.key] }">
                {{ allResults.filter(r => r.status === entry.key).length }}
              </span>
            </div>
          </div>

          <!-- Active incident detail -->
          <div v-if="activeDisaster" style="flex-shrink: 0;">
            <div class="eoc-section-hdr"><span class="inline-ico"><AppIcon name="warning" :size="13" /> Active Incident</span></div>
            <div style="padding: var(--sp-3) var(--sp-4); background: var(--need-help-dim); border-bottom: 1px solid var(--need-help-border);">
              <div class="inline-ico" style="font-size: 13px; font-weight: 700; color: var(--need-help); text-transform: uppercase; letter-spacing: 0.04em;">
                <AppIcon :name="disasterIcon(activeDisaster.type)" :size="15" />
                {{ activeDisaster.type }}
                <span v-if="activeDisaster.magnitude"> · M{{ activeDisaster.magnitude }}</span>
                <span v-if="activeDisaster.severity"> · SEV {{ activeDisaster.severity }}/5</span>
              </div>
              <div style="font-size: 12px; color: var(--text-md); margin-top: 4px; line-height: 1.5;">{{ activeDisaster.description }}</div>
              <div style="font-size: 11px; color: var(--text-lo); margin-top: 4px; font-family: var(--font-mono);">
                Radius: {{ activeDisaster.radius_km }}km · {{ activeDisaster.lat.toFixed(4) }}, {{ activeDisaster.lng.toFixed(4) }}
              </div>
            </div>
          </div>

          <!-- Shelters in radius -->
          <div class="eoc-section-hdr">
            <span class="inline-ico"><AppIcon name="home" :size="13" /> Nearby Facilities</span>
            <span class="count">{{ shelters.length }}</span>
          </div>
          <div style="max-height: 120px; overflow-y: auto; flex-shrink: 0; scrollbar-width: thin; scrollbar-color: var(--border-line) transparent;">
            <div
              v-for="s in shelters"
              :key="s.id"
              style="padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--border-line); display: flex; align-items: center; gap: var(--sp-2); font-size: 12px;"
            >
              <span class="inline-ico" :title="s.type" style="color: var(--gov-blue); flex-shrink: 0;">
                <AppIcon :name="shelterTypeIcon(s.type)" :size="15" />
              </span>
              <span style="color: var(--text-hi); font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ s.name }}</span>
              <span v-if="s.capacity" style="color: var(--text-lo); flex-shrink: 0; font-size: 11px;">cap {{ s.capacity }}</span>
            </div>
            <div v-if="shelters.length === 0" style="padding: var(--sp-3); color: var(--text-lo); font-size: 12px; text-align: center;">
              No facilities in radius
            </div>
          </div>

          <!-- Alert log -->
          <div class="eoc-section-hdr">
            <span class="inline-ico"><AppIcon name="time" :size="13" /> Alert Log</span>
            <span class="count">{{ alerts.length }}</span>
          </div>
          <div class="eoc-scroll">
            <div v-for="(a, i) in alerts" :key="i" class="eoc-alert-item" :class="a.level">
              <div class="eoc-alert-msg msg-row">
                <AppIcon :name="alertIcon(a.level)" :size="14" />
                <span><span class="eoc-alert-time">{{ a.ts }}</span> · {{ a.msg }}</span>
              </div>
            </div>
            <div v-if="alerts.length === 0" class="msg-row" style="padding: var(--sp-4); color: var(--text-lo); font-size: 12px; justify-content: center;">
              <AppIcon name="checkmark-circle" :size="14" /> No alerts yet.
            </div>
          </div>
        </div>

      </div>
    </template>
  </div>
</template>
