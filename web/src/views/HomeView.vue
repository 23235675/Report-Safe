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

const { onStatsUpdate, onDisasterAlert } = useSocket();
let offStats = null, offAlert = null;

const isActive       = computed(() => stats.value.active_disasters > 0 || disasters.value.length > 0);
const latestDisaster = computed(() => disasters.value[0] ?? null);
const missingTotal   = computed(() => (stats.value.potentially_missing || 0) + (stats.value.missing || 0));

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

async function load() {
  loading.value = true;
  error.value = false;
  try {
    const r = await getStats({ excludeWeb: true }); stats.value = r.stats || r;
    const d = await getDisasters(); disasters.value = d.disasters || [];
    loaded.value = true;
  } catch {
    // Don't show a misleading "All Clear / zero" picture on failure.
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
  <div class="home">
    <div v-if="authNotice" class="msg msg-info" style="margin-bottom: var(--sp-5);">
      {{ $t('home.authNotice') }}
    </div>

    <DisasterBanner v-if="latestDisaster && !dismissed" :disaster="latestDisaster" @close="dismissed = true" />

    <!-- ── Loading (first load) ──────────────────────────────────── -->
    <div v-if="loading && !loaded" class="state-loading"><span class="spinner"></span> {{ $t('home.loading') }}</div>

    <!-- ── Error (couldn't reach the server) ─────────────────────── -->
    <div v-else-if="error" class="state-block">
      <div class="state-icon is-error"><AppIcon name="cloud-offline" :size="26" /></div>
      <p class="state-title">{{ $t('home.cantReach') }}</p>
      <p class="state-sub">{{ $t('home.cantReachSub') }}</p>
      <button class="btn-secondary btn-sm" @click="load" style="margin-top: var(--sp-2);"><AppIcon name="refresh" :size="14" /> {{ $t('common.retry') }}</button>
    </div>

    <!-- ── Status ribbon ─────────────────────────────────────────── -->
    <template v-else>
    <div class="status-ribbon" :class="isActive ? 'ribbon-active' : 'ribbon-clear'">
      <AppIcon :name="isActive ? 'warning' : 'shield-checkmark'" :size="18" />
      <span class="ribbon-text">{{ ribbonText }}</span>
      <RouterLink to="/report" class="ribbon-cta inline-ico"><AppIcon name="megaphone" :size="14" /> {{ $t('home.reportStatus') }}</RouterLink>
    </div>

    <!-- ── Global aggregate stats (clickable → /status) ─────────── -->
    <RouterLink to="/status" class="global-stats" title="View full status breakdown">
      <div class="gs-item">
        <span class="gs-val" style="color: var(--text-hi);">{{ stats.total }}</span>
        <span class="gs-lbl inline-ico"><AppIcon name="list" :size="13" style="color: var(--text-lo);" /> {{ $t('home.statReports') }}</span>
      </div>
      <div class="gs-div"></div>
      <div class="gs-item">
        <span class="gs-val" style="color: var(--safe);">{{ stats.safe }}</span>
        <span class="gs-lbl inline-ico"><AppIcon name="checkmark-circle" :size="13" style="color: var(--safe);" /> {{ $t('home.statSafe') }}</span>
      </div>
      <div class="gs-div"></div>
      <div class="gs-item">
        <span class="gs-val" style="color: var(--injured);">{{ stats.injured }}</span>
        <span class="gs-lbl inline-ico"><AppIcon name="medkit" :size="13" style="color: var(--injured);" /> {{ $t('home.statInjured') }}</span>
      </div>
      <div class="gs-div"></div>
      <div class="gs-item">
        <span class="gs-val" style="color: var(--need-help);">{{ stats.need_help }}</span>
        <span class="gs-lbl inline-ico"><AppIcon name="alert-circle" :size="13" style="color: var(--need-help);" /> {{ $t('home.statNeedHelp') }}</span>
      </div>
      <div class="gs-div"></div>
      <div class="gs-item">
        <span class="gs-val" style="color: var(--pot-missing);">{{ missingTotal }}</span>
        <span class="gs-lbl inline-ico"><AppIcon name="person-remove" :size="13" style="color: var(--pot-missing);" /> {{ $t('home.statMissing') }}</span>
      </div>
      <div class="gs-arrow"><AppIcon name="chevron-forward" :size="14" /></div>
    </RouterLink>

    <!-- ── Active disaster cards ─────────────────────────────────── -->
    <div v-if="disasters.length > 0" class="section-block">
      <div class="section-hd">
        <h2 class="section-title">{{ $t('home.activeIncidents') }}</h2>
        <span class="section-count">{{ disasters.length }}</span>
      </div>
      <div class="disaster-grid">
        <div v-for="d in disasters" :key="d.id" class="disaster-card">
          <div class="dc-head">
            <span class="dc-icon"><AppIcon :name="typeIcon(d.type)" :size="20" /></span>
            <div class="dc-meta">
              <span class="dc-name">{{ disasterTypeLabel(d.type) }}</span>
              <span v-if="d.description" class="dc-desc">{{ d.description }}</span>
            </div>
            <span class="dc-sev" :class="severityLabel(d).cls">{{ severityLabel(d).text }}</span>
          </div>
          <div class="dc-body">
            <div class="dc-stat dc-stat-radius">
              <span class="dc-stat-val">{{ d.radius_km }}<span class="dc-stat-unit">km</span></span>
              <span class="dc-stat-lbl">{{ $t('home.radius') }}</span>
            </div>
          </div>
          <div class="dc-actions">
            <RouterLink :to="`/report?disaster_id=${d.id}`" class="dc-btn dc-btn-report">{{ $t('home.reportStatus') }}</RouterLink>
            <RouterLink :to="`/family?disaster_id=${d.id}`" class="dc-btn dc-btn-find">{{ $t('home.findSomeone') }}</RouterLink>
            <RouterLink :to="`/shelters?disaster_id=${d.id}`" class="dc-btn dc-btn-shelter">{{ $t('home.shelters') }}</RouterLink>
          </div>
        </div>
      </div>
    </div>

    <!-- ── No active disasters ───────────────────────────────────── -->
    <div v-else class="state-block">
      <div class="state-icon is-safe"><AppIcon name="shield-checkmark" :size="28" /></div>
      <p class="state-title">{{ $t('home.noActive') }}</p>
      <p class="state-sub">{{ $t('home.noActiveSub') }}</p>
    </div>
    </template>

  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: var(--sp-5); }

/* Status ribbon */
.status-ribbon {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-radius: var(--radius-md);
  font-size: 14px; font-weight: 500;
}
.ribbon-active  { background: var(--need-help-dim); border: 1px solid var(--need-help-border); color: var(--need-help); }
.ribbon-clear   { background: var(--safe-dim);      border: 1px solid var(--safe-border);      color: var(--safe); }
.ribbon-dot     { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; animation: pulse 2s infinite; }
.ribbon-text    { flex: 1; }
.ribbon-cta     { padding: 4px 12px; background: var(--gov-blue); color: white; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.ribbon-cta:hover { background: var(--gov-blue-text); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

/* Global stats bar — clickable link to /status */
.global-stats {
  display: flex; align-items: center; justify-content: space-around;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-panel); border: 1px solid var(--border-line);
  border-radius: var(--radius-md); box-shadow: var(--shadow-xs);
  text-decoration: none; cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
  flex-wrap: nowrap; overflow-x: auto; gap: var(--sp-2);
}
.global-stats:hover { box-shadow: var(--shadow-md); border-color: var(--border-strong); }
.gs-item  { display: flex; flex-direction: column; align-items: center; gap: 3px; flex-shrink: 0; }
.gs-val   { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
.gs-lbl   { font-size: 10px; color: var(--text-lo); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; }
.gs-div   { width: 1px; height: 32px; background: var(--border-line); flex-shrink: 0; }
.gs-arrow { color: var(--text-lo); margin-left: var(--sp-1); flex-shrink: 0; }

@media (max-width: 480px) {
  .gs-val { font-size: 18px; }
  .gs-div { height: 24px; }
  .global-stats { padding: var(--sp-3); }
}

/* Section */
.section-block  { display: flex; flex-direction: column; gap: var(--sp-3); }
.section-hd     { display: flex; align-items: center; gap: var(--sp-2); }
.section-title  { font-size: 15px; font-weight: 700; color: var(--text-hi); margin: 0; }
.section-count  { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; background: var(--gov-blue); color: white; border-radius: 10px; font-size: 11px; font-weight: 700; }

/* Disaster cards */
.disaster-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--sp-3); }
@media (max-width: 480px) {
  .disaster-grid { grid-template-columns: 1fr; }
  .dc-actions { flex-wrap: wrap; }
  .dc-btn { min-width: calc(50% - 4px); }
}
.disaster-card {
  background: var(--bg-panel); border: 1px solid var(--border-line);
  border-radius: var(--radius-lg); overflow: hidden;
  box-shadow: var(--shadow-xs); transition: box-shadow 0.15s, border-color 0.15s;
}
.disaster-card:hover { box-shadow: var(--shadow-md); border-color: var(--border-strong); }

.dc-head { display: flex; align-items: flex-start; gap: var(--sp-3); padding: var(--sp-4); border-bottom: 1px solid var(--border-line); }
.dc-icon { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; background: var(--disaster-dim); color: var(--disaster); border-radius: var(--radius-md); flex-shrink: 0; }
.dc-meta { flex: 1; min-width: 0; }
.dc-name { display: block; font-size: 15px; font-weight: 700; color: var(--text-hi); }
.dc-desc { display: block; font-size: 12px; color: var(--text-lo); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dc-sev { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; align-self: flex-start; }
.sev-extreme { background: var(--need-help-dim); color: var(--need-help); }
.sev-severe  { background: var(--awaiting-dim);  color: var(--awaiting); }
.sev-moderate{ background: var(--injured-dim);   color: var(--injured); }
.sev-minor   { background: var(--safe-dim);      color: var(--safe); }

.dc-body { padding: var(--sp-3) var(--sp-4); }
.dc-stat { display: inline-flex; flex-direction: column; align-items: flex-start; }
.dc-stat-val  { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-hi); line-height: 1; }
.dc-stat-unit { font-size: 12px; font-weight: 400; margin-left: 1px; }
.dc-stat-lbl  { font-size: 11px; color: var(--text-lo); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }

.dc-actions { display: flex; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); background: var(--bg-raised); }
.dc-btn { flex: 1; padding: 6px 4px; text-align: center; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; text-decoration: none; transition: opacity 0.1s; }
.dc-btn:hover { opacity: 0.85; }
.dc-btn-report  { background: var(--need-help); color: white; }
.dc-btn-find    { background: var(--gov-blue-dim); color: var(--gov-blue-text); border: 1px solid var(--gov-blue-border); }
.dc-btn-shelter { background: var(--safe-dim); color: var(--safe); border: 1px solid var(--safe-border); }

/* No disasters */
.no-disasters { display: flex; flex-direction: column; align-items: center; padding: var(--sp-7) var(--sp-4); text-align: center; background: var(--bg-panel); border: 1px solid var(--border-line); border-radius: var(--radius-lg); }
.no-dis-icon  { margin-bottom: var(--sp-3); }
.no-dis-title { font-size: 16px; font-weight: 600; color: var(--text-hi); margin: 0 0 var(--sp-2); }
.no-dis-sub   { font-size: 14px; color: var(--text-lo); margin: 0; }

</style>
