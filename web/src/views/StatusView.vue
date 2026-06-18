<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getStats, getDisasters } from '../api.js';
import { useSocket } from '../socket.js';
import AppIcon from '../components/AppIcon.vue';

const stats = ref({
  total: 0, safe: 0, injured: 0, need_help: 0,
  awaiting_response: 0, potentially_missing: 0, missing: 0,
  verified_missing: 0, rescued: 0, deceased: 0, active_disasters: 0,
});
const disasters = ref([]);
const loading   = ref(true);
const error     = ref(false);

const { onStatsUpdate } = useSocket();
let offStats = null;

const pct = (n) => stats.value.total ? Math.round((n / stats.value.total) * 100) : 0;

const categories = computed(() => [
  { key: 'safe',               label: 'Safe',               icon: 'checkmark-circle', color: 'var(--safe)',        dim: 'var(--safe-dim)',        border: 'var(--safe-border)',        val: stats.value.safe },
  { key: 'injured',            label: 'Injured',            icon: 'medkit',           color: 'var(--injured)',     dim: 'var(--injured-dim)',     border: 'var(--injured-border)',     val: stats.value.injured },
  { key: 'need_help',          label: 'Need Help',          icon: 'alert-circle',     color: 'var(--need-help)',   dim: 'var(--need-help-dim)',   border: 'var(--need-help-border)',   val: stats.value.need_help },
  { key: 'awaiting_response',  label: 'Awaiting Response',  icon: 'time',             color: 'var(--awaiting)',    dim: 'var(--awaiting-dim)',    border: 'var(--awaiting-border)',    val: stats.value.awaiting_response },
  { key: 'potentially_missing',label: 'Potentially Missing',icon: 'person-remove',    color: 'var(--pot-missing)', dim: 'var(--pot-missing-dim)', border: 'var(--pot-missing-border)', val: stats.value.potentially_missing },
  { key: 'missing',            label: 'Missing',            icon: 'search',           color: 'var(--missing)',     dim: 'var(--missing-dim)',     border: 'var(--missing-border)',     val: stats.value.missing },
  { key: 'verified_missing',   label: 'Verified Missing',   icon: 'warning',          color: 'var(--pot-missing)', dim: 'var(--pot-missing-dim)', border: 'var(--pot-missing-border)', val: stats.value.verified_missing },
  { key: 'rescued',            label: 'Rescued',            icon: 'shield-checkmark', color: 'var(--rescued)',     dim: 'var(--rescued-dim)',     border: 'var(--rescued-border)',     val: stats.value.rescued },
  { key: 'deceased',           label: 'Deceased',           icon: 'remove-circle',    color: 'var(--deceased)',    dim: 'var(--deceased-dim)',    border: 'var(--deceased-border)',    val: stats.value.deceased },
]);

const stackSegments = computed(() => categories.value
  .filter((c) => c.val > 0)
  .map((c) => ({ ...c, w: pct(c.val) }))
);

async function load() {
  loading.value = true;
  error.value   = false;
  try {
    const [r, d] = await Promise.all([getStats(), getDisasters()]);
    stats.value    = r.stats || r;
    disasters.value = d.disasters || [];
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  offStats = onStatsUpdate((s) => { stats.value = s; });
});
onUnmounted(() => { offStats?.(); });
</script>

<template>
  <div class="status-view">

    <!-- Header -->
    <div class="sv-header">
      <div class="sv-title-row">
        <div>
          <h1 class="sv-title">Status Overview</h1>
          <p class="sv-sub">Live breakdown of all reported statuses across active incidents</p>
        </div>
        <button class="btn-secondary btn-sm" @click="load" :disabled="loading">
          <AppIcon name="refresh" :size="14" />
          Refresh
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading && !stats.total && !error" class="state-loading">
      <span class="spinner"></span> Loading status data…
    </div>

    <!-- Error -->
    <div v-else-if="error" class="state-block">
      <div class="state-icon is-error"><AppIcon name="cloud-offline" :size="26" /></div>
      <p class="state-title">Can't reach the server</p>
      <p class="state-sub">Status data is unavailable. Check your connection and retry.</p>
      <button class="btn-secondary btn-sm" @click="load" style="margin-top: var(--sp-2);">
        <AppIcon name="refresh" :size="14" /> Retry
      </button>
    </div>

    <template v-else>

      <!-- Total + disasters callout -->
      <div class="callout-row">
        <div class="callout-card callout-total">
          <AppIcon name="list" :size="22" style="color: var(--text-lo);" />
          <div class="callout-body">
            <span class="callout-val">{{ stats.total }}</span>
            <span class="callout-lbl">Total Reports</span>
          </div>
        </div>
        <div class="callout-card callout-disasters">
          <AppIcon name="warning" :size="22" style="color: var(--need-help);" />
          <div class="callout-body">
            <span class="callout-val" style="color: var(--need-help);">{{ stats.active_disasters }}</span>
            <span class="callout-lbl">Active Disasters</span>
          </div>
        </div>
      </div>

      <!-- Stacked proportion bar -->
      <div v-if="stats.total > 0" class="prop-section">
        <div class="prop-label">Report breakdown by status</div>
        <div class="prop-bar">
          <div
            v-for="seg in stackSegments" :key="seg.key"
            class="prop-seg"
            :style="{ width: seg.w + '%', background: seg.color }"
            :title="`${seg.label}: ${seg.val} (${seg.w}%)`"
          ></div>
        </div>
        <div class="prop-legend">
          <span v-for="seg in stackSegments" :key="seg.key" class="legend-item">
            <span class="legend-dot" :style="{ background: seg.color }"></span>
            {{ seg.label }}
          </span>
        </div>
      </div>

      <!-- Status cards grid -->
      <div class="status-grid">
        <div
          v-for="cat in categories" :key="cat.key"
          class="status-card"
          :style="{ background: cat.dim, borderColor: cat.border }"
        >
          <div class="sc-icon" :style="{ color: cat.color }">
            <AppIcon :name="cat.icon" :size="20" />
          </div>
          <div class="sc-count" :style="{ color: cat.color }">{{ cat.val || 0 }}</div>
          <div class="sc-label">{{ cat.label }}</div>
          <div class="sc-bar-wrap">
            <div
              class="sc-bar-fill"
              :style="{ width: pct(cat.val || 0) + '%', background: cat.color }"
            ></div>
          </div>
          <div class="sc-pct">{{ pct(cat.val || 0) }}%</div>
        </div>
      </div>

      <!-- Active disasters reference -->
      <div v-if="disasters.length > 0" class="section-block">
        <div class="section-hd">
          <h2 class="section-title">Active Incidents</h2>
          <span class="section-count">{{ disasters.length }}</span>
        </div>
        <div class="disaster-list">
          <div v-for="d in disasters" :key="d.id" class="dl-row">
            <AppIcon name="warning" :size="16" style="color: var(--need-help); flex-shrink: 0;" />
            <span class="dl-name">{{ d.type.charAt(0).toUpperCase() + d.type.slice(1) }}</span>
            <span v-if="d.description" class="dl-desc">{{ d.description }}</span>
            <span class="dl-radius">{{ d.radius_km }} km radius</span>
          </div>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.status-view { display: flex; flex-direction: column; gap: var(--sp-5); }

/* Header */
.sv-header     { }
.sv-title-row  { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; }
.sv-title      { font-size: 22px; font-weight: 700; color: var(--text-hi); margin: 0 0 4px; }
.sv-sub        { font-size: 13px; color: var(--text-lo); margin: 0; }

/* Callout row */
.callout-row  { display: flex; gap: var(--sp-4); flex-wrap: wrap; }
.callout-card {
  flex: 1; min-width: 140px;
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5);
  background: var(--bg-panel); border: 1px solid var(--border-line);
  border-radius: var(--radius-md); box-shadow: var(--shadow-xs);
}
.callout-body  { display: flex; flex-direction: column; }
.callout-val   { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; color: var(--text-hi); }
.callout-lbl   { font-size: 12px; color: var(--text-lo); margin-top: 3px; text-transform: uppercase; letter-spacing: 0.04em; }

/* Proportion bar */
.prop-section { display: flex; flex-direction: column; gap: var(--sp-2); }
.prop-label   { font-size: 12px; font-weight: 600; color: var(--text-lo); text-transform: uppercase; letter-spacing: 0.05em; }
.prop-bar     { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: var(--bg-raised); border: 1px solid var(--border-line); }
.prop-seg     { transition: width 0.4s ease; min-width: 2px; }
.prop-legend  { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); margin-top: var(--sp-1); }
.legend-item  { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-lo); }
.legend-dot   { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

/* Status grid */
.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--sp-3);
}
.status-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2);
  padding: var(--sp-4);
  border: 1px solid; border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xs); transition: box-shadow 0.15s;
}
.status-card:hover { box-shadow: var(--shadow-md); }
.sc-icon  { display: inline-grid; place-items: center; width: 36px; height: 36px; background: rgba(255,255,255,0.55); border-radius: var(--radius-md); }
.sc-count { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
.sc-label { font-size: 12px; color: var(--text-md); font-weight: 600; }
.sc-bar-wrap { width: 100%; height: 4px; background: rgba(0,0,0,0.08); border-radius: 2px; overflow: hidden; }
.sc-bar-fill { height: 100%; border-radius: 2px; transition: width 0.4s ease; min-width: 2px; }
.sc-pct   { font-size: 11px; color: var(--text-lo); }

/* Section */
.section-block { display: flex; flex-direction: column; gap: var(--sp-3); }
.section-hd    { display: flex; align-items: center; gap: var(--sp-2); }
.section-title { font-size: 15px; font-weight: 700; color: var(--text-hi); margin: 0; }
.section-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; background: var(--gov-blue); color: white; border-radius: 10px; font-size: 11px; font-weight: 700; }

/* Disaster list */
.disaster-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.dl-row {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-panel); border: 1px solid var(--border-line);
  border-radius: var(--radius-md);
}
.dl-name   { font-size: 14px; font-weight: 600; color: var(--text-hi); }
.dl-desc   { flex: 1; font-size: 12px; color: var(--text-lo); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dl-radius { font-size: 12px; color: var(--text-lo); white-space: nowrap; margin-left: auto; }
</style>
