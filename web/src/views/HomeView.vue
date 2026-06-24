<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { getStats, getDisasters } from '../api.js';
import { useSocket } from '../socket.js';
import DisasterBanner from '../components/DisasterBanner.vue';
import AppIcon from '../components/AppIcon.vue';
import { DISASTER_ICON, severityInfo } from '../iconography.js';
import { t, severityKey, disasterTypeLabel } from '../i18n/index.js';

const route      = useRoute();
const authNotice = ref(route.query.authRequired === 'true');

const stats     = ref({ total: 0, safe: 0, injured: 0, need_help: 0, awaiting_response: 0, potentially_missing: 0, missing: 0, active_disasters: 0 });
const disasters = ref([]);
const dismissed = ref(false);
const loading   = ref(true);
const loaded    = ref(false);
const error     = ref(false);

const typeFilter = ref('all');

const { onStatsUpdate, onDisasterAlert } = useSocket();
let offStats = null, offAlert = null;

const isActive       = computed(() => stats.value.active_disasters > 0 || disasters.value.length > 0);
const latestDisaster = computed(() => disasters.value[0] ?? null);
const missingTotal   = computed(() => (stats.value.potentially_missing || 0) + (stats.value.missing || 0));

const availableTypes    = computed(() => [...new Set(disasters.value.map((d) => d.type).filter(Boolean))]);
const filteredDisasters = computed(() =>
  typeFilter.value === 'all'
    ? disasters.value
    : disasters.value.filter((d) => d.type === typeFilter.value)
);

const ribbonText = computed(() => {
  if (!isActive.value) return t('home.ribbonClear');
  const n = disasters.value.length;
  return t(n === 1 ? 'home.ribbonActiveOne' : 'home.ribbonActiveMany', { n });
});

function severityLabel(d) {
  return { text: t(`severity.${severityKey(d.severity)}`), cls: severityInfo(d.severity).cls };
}

function typeIcon(type) {
  return DISASTER_ICON[type?.toLowerCase()] || 'warning';
}

function lastUpdatedText(d) {
  const ts = d.ended_at || d.started_at;
  if (!ts) return '—';
  try { return new Date(Number(ts)).toLocaleString(); } catch { return '—'; }
}

function printReport() {
  if (typeof window !== 'undefined') window.print();
}

async function load() {
  loading.value = true;
  error.value = false;
  try {
    const r = await getStats({ excludeWeb: true }); stats.value = r.stats || r;
    const d = await getDisasters(); disasters.value = d.disasters || [];
    loaded.value = true;
  } catch {
    if (!loaded.value) error.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
  offStats = onStatsUpdate((s) => { stats.value = s; });
  offAlert = onDisasterAlert((d) => {
    if (!disasters.value.find((x) => x.id === d.id)) disasters.value = [d, ...disasters.value];
    dismissed.value = false;
  });
});
onUnmounted(() => { offStats?.(); offAlert?.(); });
</script>

<template>
  <div class="home resp-shell">

    <div class="ds-header no-print">
      <h1>{{ $t('home.pageTitle') }}</h1>
      <div class="ds-header-actions">
        <span class="ds-status-chip"><span class="ds-status-dot"></span> {{ $t('home.statusActive') }}</span>
        <button class="btn-teal-action" @click="printReport">
          <AppIcon name="list" :size="14" /> {{ $t('home.printReport') }}
        </button>
      </div>
    </div>

    <div v-if="authNotice" class="msg msg-info no-print" style="margin-bottom: var(--sp-5);">
      {{ $t('home.authNotice') }}
    </div>

    <DisasterBanner v-if="latestDisaster && !dismissed" :disaster="latestDisaster" @close="dismissed = true" />

    <div v-if="loading && !loaded" class="state-loading"><span class="spinner"></span> {{ $t('home.loading') }}</div>

    <div v-else-if="error" class="state-block">
      <div class="state-icon is-error"><AppIcon name="cloud-offline" :size="26" /></div>
      <p class="state-title">{{ $t('home.cantReach') }}</p>
      <p class="state-sub">{{ $t('home.cantReachSub') }}</p>
      <button class="btn-secondary-outline" @click="load" style="margin-top: var(--sp-2);"><AppIcon name="refresh" :size="14" /> {{ $t('common.retry') }}</button>
    </div>

    <template v-else>
      <div class="status-ribbon" :class="isActive ? 'ribbon-active' : 'ribbon-clear'">
        <AppIcon :name="isActive ? 'warning' : 'shield-checkmark'" :size="18" />
        <span class="ribbon-text">{{ ribbonText }}</span>
        <RouterLink to="/report" class="ribbon-cta inline-ico no-print"><AppIcon name="megaphone" :size="14" /> {{ $t('home.reportStatus') }}</RouterLink>
      </div>

      <RouterLink to="/status" class="global-stats" title="View full status breakdown">
        <div class="gs-item">
          <span class="gs-val" style="color: var(--text-hi);">{{ stats.total }}</span>
          <span class="gs-lbl inline-ico"><AppIcon name="list" :size="13" style="color: var(--text-lo);" /> {{ $t('home.statReports') }}</span>
        </div>
        <div class="gs-div"></div>
        <div class="gs-item">
          <span class="gs-val" style="color: var(--text-hi);">{{ stats.safe }}</span>
          <span class="gs-lbl inline-ico"><AppIcon name="checkmark-circle" :size="13" style="color: var(--text-lo);" /> {{ $t('home.statSafe') }}</span>
        </div>
        <div class="gs-div"></div>
        <div class="gs-item">
          <span class="gs-val" style="color: var(--text-hi);">{{ stats.injured }}</span>
          <span class="gs-lbl inline-ico"><AppIcon name="medkit" :size="13" style="color: var(--text-lo);" /> {{ $t('home.statInjured') }}</span>
        </div>
        <div class="gs-div"></div>
        <div class="gs-item">
          <span class="gs-val" style="color: var(--text-hi);">{{ stats.need_help }}</span>
          <span class="gs-lbl inline-ico"><AppIcon name="alert-circle" :size="13" style="color: var(--text-lo);" /> {{ $t('home.statNeedHelp') }}</span>
        </div>
        <div class="gs-div"></div>
        <div class="gs-item">
          <span class="gs-val" style="color: var(--text-md);">{{ missingTotal }}</span>
          <span class="gs-lbl inline-ico"><AppIcon name="person-remove" :size="13" style="color: var(--text-lo);" /> {{ $t('home.statMissing') }}</span>
        </div>
        <div class="gs-arrow no-print"><AppIcon name="chevron-forward" :size="14" /></div>
      </RouterLink>

      <div v-if="disasters.length > 0" class="section-block">
        <div class="section-hd">
          <h2 class="section-title">{{ $t('home.affectedZones') }}</h2>
          <span class="section-count">{{ filteredDisasters.length }}</span>
        </div>

        <div v-if="availableTypes.length > 1" class="ds-filters no-print">
          <button class="ds-chip" :class="{ on: typeFilter === 'all' }" @click="typeFilter = 'all'">{{ $t('home.filterAll') }}</button>
          <button
            v-for="ty in availableTypes"
            :key="ty"
            class="ds-chip"
            :class="{ on: typeFilter === ty }"
            @click="typeFilter = ty"
          >
            <AppIcon :name="typeIcon(ty)" :size="13" /> {{ disasterTypeLabel(ty) }}
          </button>
        </div>

        <div class="zone-list">
          <div v-for="d in filteredDisasters" :key="d.id" class="zone-row">
            <span class="zone-icon"><AppIcon :name="typeIcon(d.type)" :size="20" /></span>
            <div class="zone-main">
              <div class="zone-title-row">
                <span class="zone-name">{{ disasterTypeLabel(d.type) }}</span>
                <span class="dc-sev" :class="severityLabel(d).cls">{{ severityLabel(d).text }}</span>
              </div>
              <div class="zone-loc">{{ d.description || `${Number(d.lat).toFixed(3)}, ${Number(d.lng).toFixed(3)}` }}</div>
              <div class="zone-meta">
                <span class="inline-ico"><AppIcon name="navigate" :size="12" /> {{ d.radius_km }} km</span>
                <span class="inline-ico"><AppIcon name="time" :size="12" /> {{ $t('home.lastUpdated') }} {{ lastUpdatedText(d) }}</span>
              </div>
              <div class="zone-actions no-print">
                <RouterLink :to="`/report?disaster_id=${d.id}`" class="dc-btn dc-btn-report">{{ $t('home.reportStatus') }}</RouterLink>
                <RouterLink :to="`/family?disaster_id=${d.id}`" class="dc-btn dc-btn-find">{{ $t('home.findSomeone') }}</RouterLink>
                <RouterLink :to="`/shelters?disaster_id=${d.id}`" class="dc-btn dc-btn-shelter">{{ $t('home.shelters') }}</RouterLink>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="state-block">
        <div class="state-icon is-safe"><AppIcon name="shield-checkmark" :size="28" /></div>
        <p class="state-title">{{ $t('home.noActive') }}</p>
        <p class="state-sub">{{ $t('home.noActiveSub') }}</p>
      </div>
    </template>

  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--sp-5);
  max-width: 820px;
  margin: 0 auto;
  padding: var(--sp-5);
}

/* Master Scoped Layout Colors */
.resp-shell {
  --resp-teal-header:   #2a706d;
  --resp-teal-accent:   #0f766e;
  --resp-teal-action:   #034e4b;
  --resp-accent-dim:    #f2f8f7;
  --resp-accent-border: #99cbc8;
  --resp-accent-text:   #044e4b;
}

/* Page Header and Titles */
.ds-header { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); flex-wrap: wrap; }
.ds-header h1 { font-size: 26px; font-weight: 700; color: var(--text-hi); margin: 0; }
.ds-header-actions { display: flex; align-items: center; gap: var(--sp-3); }

.ds-status-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: #ffffff;
  background: var(--resp-teal-action); border: 1px solid var(--resp-teal-action);
  padding: 4px 10px; border-radius: 2px; text-transform: uppercase; letter-spacing: 0.03em;
}
.ds-status-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

/* Control Buttons */
.btn-teal-action {
  background: var(--resp-teal-action);
  color: #ffffff; border: none;
  padding: var(--sp-2) var(--sp-4);
  font-size: 13px; font-weight: 600;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer; display: inline-flex; align-items: center; gap: var(--sp-2);
}
.btn-teal-action:hover { background: var(--resp-teal-accent); }

.btn-secondary-outline {
  background: #ffffff; color: var(--text-md);
  border: 1px solid var(--border-line, #cbd5e1);
  padding: var(--sp-2) var(--sp-4);
  font-size: 13px; font-weight: 500;
  border-radius: var(--radius-sm, 4px); cursor: pointer;
}
.btn-secondary-outline:hover { background: #f8fafc; border-color: var(--text-lo); }

/* Status Ribbon */
.status-ribbon {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4); border-radius: var(--radius-sm, 4px);
  font-size: 13.5px; font-weight: 500; border: 1px solid var(--border-line, #cbd5e1);
}
.ribbon-active  { background: var(--resp-teal-action); border-color: var(--resp-teal-action); color: #ffffff; }
.ribbon-clear   { background: var(--resp-accent-dim); border-color: var(--resp-accent-border); color: var(--resp-accent-text); }
.ribbon-text    { flex: 1; }
.ribbon-cta     { padding: var(--sp-1) var(--sp-3); background: #ffffff; color: var(--resp-teal-action); border-radius: 2px; font-size: 12px; font-weight: 700; text-decoration: none; }
.ribbon-cta:hover { background: var(--resp-accent-dim); }

/* Global Stats Panel Grid */
.global-stats {
  display: flex; align-items: center; justify-content: space-around;
  padding: var(--sp-4); background: #ffffff; border: 1px solid var(--border-line, #cbd5e1);
  border-radius: var(--radius-sm, 4px); text-decoration: none; cursor: pointer;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.02); gap: var(--sp-2);
}
.global-stats:hover { border-color: var(--resp-teal-accent); }
.gs-item  { display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
.gs-val   { font-size: 24px; font-weight: 700; line-height: 1; }
.gs-lbl   { font-size: 11px; color: var(--text-lo); font-weight: 600; text-transform: uppercase; }
.gs-div   { width: 1px; height: 34px; background: var(--border-line, #cbd5e1); }
.gs-arrow { color: var(--text-lo); }

/* Filter Horizontal Dark Teal Row */
.ds-filters {
  display: flex; gap: var(--sp-1);
  background: var(--resp-teal-header);
  border-radius: var(--radius-sm, 4px); padding: 4px 8px;
}
.ds-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 var(--sp-3); background: transparent;
  border: none; border-bottom: 3px solid transparent;
  font-size: 13px; font-weight: 500; color: #d5e0f0; cursor: pointer;
}
.ds-chip:hover { color: #ffffff; }
.ds-chip.on { font-weight: 700; color: #ffffff; border-bottom-color: #ffffff; background: rgba(255, 255, 255, 0.1); }

/* Zone Records Sheets */
.section-block { display: flex; flex-direction: column; gap: var(--sp-3); }
.section-title { font-size: 16px; font-weight: 700; color: var(--text-hi); margin: 0; }
.section-count { display: inline-flex; align-items: center; justify-content: center; background: var(--resp-teal-accent); color: white; padding: 2px 6px; font-size: 11px; font-weight: 700; border-radius: 10px; }
.zone-list { display: flex; flex-direction: column; gap: var(--sp-2); }
.zone-row {
  display: flex; gap: var(--sp-4); background: #ffffff;
  border: 1px solid var(--border-line, #cbd5e1);
  border-radius: var(--radius-sm, 4px); padding: var(--sp-4);
}
.zone-icon { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: #f1f5f9; color: var(--resp-teal-accent); border-radius: 4px; }
.zone-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.zone-title-row { display: flex; align-items: center; justify-content: space-between; }
.zone-name { font-size: 15px; font-weight: 700; color: var(--text-hi); }
.zone-loc  { font-size: 13.5px; color: var(--text-md); }
.zone-meta { display: flex; gap: var(--sp-4); font-size: 12px; color: var(--text-lo); }
.zone-actions { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }

/* Action Links */
.dc-btn { flex: 1; padding: 8px var(--sp-2); text-align: center; border-radius: 4px; font-size: 12.5px; font-weight: 600; text-decoration: none; }
.dc-btn-report { background: var(--resp-teal-action); color: #ffffff; }
.dc-btn-report:hover { background: var(--resp-teal-accent); }
.dc-btn-find { background: #ffffff; color: var(--text-md); border: 1px solid var(--border-line, #cbd5e1); }
.dc-btn-find:hover { background: #f8fafc; }
.dc-btn-shelter { background: var(--resp-accent-dim); color: var(--resp-accent-text); border: 1px solid var(--resp-accent-border); }

/* Severity Scale System badges */
/* Severity = monochrome system tag; the SEV label carries the meaning, not colour. */
.dc-sev { padding: 2px 8px; border-radius: 2px; font-size: 11px; font-weight: 700; text-transform: uppercase; font-family: var(--font-mono); letter-spacing: 0.02em; border: 1px solid #cbd5e1; }
.sev-extreme,
.sev-severe,
.sev-moderate,
.sev-minor { background: #f1f5f9; color: var(--text-hi); }

@media print {
  .no-print { display: none !important; }
  .zone-row { box-shadow: none; break-inside: avoid; }
}
</style>
