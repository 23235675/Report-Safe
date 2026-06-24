<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getStats, getDisasters, getPeople } from '../api.js';
import { useSocket } from '../socket.js';
import AppIcon from '../components/AppIcon.vue';
import { t, disasterTypeLabel } from '../i18n/index.js';

// 1. 將不變的視覺樣式抽離，避免每次 WebSocket 更新時都在 Computed 內重複建立物件
const CATEGORY_CONFIGS = [
  { key: 'safe',               icon: 'checkmark-circle', color: 'var(--safe)',        dim: 'var(--safe-dim)',        border: 'var(--safe-border)' },
  { key: 'injured',            icon: 'medkit',           color: 'var(--injured)',     dim: 'var(--injured-dim)',     border: 'var(--injured-border)' },
  { key: 'need_help',          icon: 'alert-circle',     color: 'var(--need-help)',   dim: 'var(--need-help-dim)',   border: 'var(--need-help-border)' },
  { key: 'awaiting_response',  icon: 'time',             color: 'var(--awaiting)',    dim: 'var(--awaiting-dim)',    border: 'var(--awaiting-border)' },
  { key: 'potentially_missing',icon: 'person-remove',    color: 'var(--pot-missing)', dim: 'var(--pot-missing-dim)', border: 'var(--pot-missing-border)' },
  { key: 'missing',            icon: 'search',           color: 'var(--missing)',     dim: 'var(--missing-dim)',     border: 'var(--missing-border)' },
  { key: 'verified_missing',   icon: 'warning',          color: 'var(--pot-missing)', dim: 'var(--pot-missing-dim)', border: 'var(--pot-missing-border)' },
  { key: 'rescued',            icon: 'shield-checkmark', color: 'var(--rescued)',     dim: 'var(--rescued-dim)',     border: 'var(--rescued-border)' },
  { key: 'deceased',           icon: 'remove-circle',    color: 'var(--deceased)',    dim: 'var(--deceased-dim)',    border: 'var(--deceased-border)' },
];

const stats = ref({
  total: 0, safe: 0, injured: 0, need_help: 0,
  awaiting_response: 0, potentially_missing: 0, missing: 0,
  verified_missing: 0, rescued: 0, deceased: 0, active_disasters: 0,
});
const disasters = ref([]);
const people    = ref([]);
const peopleTotal = ref(0);
const peopleOffset = ref(0);
const PEOPLE_PAGE = 50;
const loading   = ref(true);
const error     = ref(false);

const statusConfigByKey = computed(() => Object.fromEntries(CATEGORY_CONFIGS.map((c) => [c.key, c])));
function statusLabel(status) { return status ? t(`status.${status}`) : '—'; }
function statusColor(status) { return statusConfigByKey.value[status]?.color || 'var(--text-lo)'; }

const { onStatsUpdate } = useSocket();
let offStats = null;
let lastUpdatedBySocket = 0; // 用於防範 API 覆蓋最新 WebSocket 數據的標記

const pct = (n) => stats.value.total ? Math.round((n / stats.value.total) * 100) : 0;

// 只針對變動的數據與語系進行響應式計算
const categories = computed(() =>
  CATEGORY_CONFIGS.map(cfg => ({
    ...cfg,
    label: t(`status.${cfg.key}`),
    val: stats.value[cfg.key] || 0
  }))
);

const stackSegments = computed(() => categories.value
  .filter((c) => c.val > 0)
  .map((c) => ({ ...c, w: pct(c.val) }))
);

async function load() {
  loading.value = true;
  error.value   = false;
  const requestTime = Date.now();
  try {
    const [r, d, p] = await Promise.all([getStats(), getDisasters(), getPeople({ limit: PEOPLE_PAGE, offset: peopleOffset.value })]);

    // 只有在 API 回傳比最後一次 WebSocket 更新還要新，或者還沒收到 WebSocket 時才寫入統計
    if (requestTime > lastUpdatedBySocket) {
      stats.value = r.stats || r;
    }
    disasters.value = d.disasters || [];
    people.value = p.people || [];
    peopleTotal.value = p.total || 0;
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
}

function nextPeoplePage() { peopleOffset.value += PEOPLE_PAGE; load(); }
function prevPeoplePage() { peopleOffset.value = Math.max(0, peopleOffset.value - PEOPLE_PAGE); load(); }

onMounted(() => {
  load();
  offStats = onStatsUpdate((s) => {
    lastUpdatedBySocket = Date.now(); // 記錄 WebSocket 更新的時間節點
    stats.value = s;
  });
});

onUnmounted(() => {
  if (offStats) offStats();
});
</script>

<template>
  <div class="status-view">

    <div class="sv-header">
      <div class="sv-title-row">
        <div>
          <h1 class="sv-title">{{ $t('statusView.title') }}</h1>
          <p class="sv-sub">{{ $t('statusView.subtitle') }}</p>
        </div>
        <button class="btn-secondary btn-sm" @click="load" :disabled="loading">
          <AppIcon name="refresh" :size="14" />
          {{ $t('common.refresh') }}
        </button>
      </div>
    </div>

    <div v-if="loading && !stats.total && !error" class="state-loading">
      <span class="spinner"></span> {{ $t('statusView.loading') }}
    </div>

    <div v-else-if="error" class="state-block">
      <div class="state-icon is-error"><AppIcon name="cloud-offline" :size="26" /></div>
      <p class="state-title">{{ $t('statusView.cantReach') }}</p>
      <p class="state-sub">{{ $t('statusView.cantReachSub') }}</p>
      <button class="btn-secondary btn-sm" @click="load" style="margin-top: var(--sp-2);">
        <AppIcon name="refresh" :size="14" /> {{ $t('common.retry') }}
      </button>
    </div>

    <template v-else>

      <div class="callout-row">
        <div class="callout-card callout-total">
          <AppIcon name="list" :size="22" style="color: var(--text-lo);" />
          <div class="callout-body">
            <span class="callout-val">{{ stats.total }}</span>
            <span class="callout-lbl">{{ $t('statusView.totalReports') }}</span>
          </div>
        </div>
        <div class="callout-card callout-disasters">
          <AppIcon name="warning" :size="22" style="color: var(--need-help);" />
          <div class="callout-body">
            <span class="callout-val" style="color: var(--need-help);">{{ stats.active_disasters }}</span>
            <span class="callout-lbl">{{ $t('statusView.activeDisasters') }}</span>
          </div>
        </div>
      </div>

      <div v-if="stats.total > 0" class="prop-section">
        <div class="prop-label">{{ $t('statusView.breakdown') }}</div>
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

      <div v-if="disasters.length > 0" class="section-block">
        <div class="section-hd">
          <h2 class="section-title">{{ $t('statusView.activeIncidents') }}</h2>
          <span class="section-count">{{ disasters.length }}</span>
        </div>
        <div class="disaster-list">
          <div v-for="d in disasters" :key="d.id" class="dl-row">
            <AppIcon name="warning" :size="16" style="color: var(--need-help); flex-shrink: 0;" />
            <span class="dl-name">{{ disasterTypeLabel(d.type) }}</span>
            <span v-if="d.description" class="dl-desc">{{ d.description }}</span>
            <span class="dl-radius">{{ $t('statusView.kmRadius', { n: d.radius_km }) }}</span>
          </div>
        </div>
      </div>

      <div class="section-block">
        <div class="section-hd">
          <h2 class="section-title">{{ $t('statusView.peopleTitle') }}</h2>
          <span class="section-count">{{ peopleTotal }}</span>
        </div>
        <div v-if="people.length === 0" class="state-block">
          <p class="state-sub">{{ $t('statusView.noPeople') }}</p>
        </div>
        <table v-else class="people-table">
          <thead>
            <tr>
              <th>{{ $t('statusView.colName') }}</th>
              <th>{{ $t('statusView.colPhone') }}</th>
              <th>{{ $t('statusView.colStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in people" :key="p.id">
              <td class="pt-name">{{ p.name }}</td>
              <td class="pt-phone font-mono">{{ p.phone_masked || '—' }}</td>
              <td><span class="pt-status" :style="{ color: statusColor(p.status) }">{{ statusLabel(p.status) }}</span></td>
            </tr>
          </tbody>
        </table>
        <div v-if="peopleTotal > PEOPLE_PAGE" class="people-pager">
          <button class="btn-secondary btn-sm" :disabled="peopleOffset === 0" @click="prevPeoplePage">{{ $t('common.prev') }}</button>
          <span class="people-pager-pos">{{ peopleOffset + 1 }}–{{ Math.min(peopleOffset + PEOPLE_PAGE, peopleTotal) }} / {{ peopleTotal }}</span>
          <button class="btn-secondary btn-sm" :disabled="peopleOffset + PEOPLE_PAGE >= peopleTotal" @click="nextPeoplePage">{{ $t('common.next') }}</button>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
/* 保持原樣式配置不變，結構完全相容 */
.status-view { display: flex; flex-direction: column; gap: var(--sp-5); }

.sv-header     { }
.sv-title-row  { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); flex-wrap: wrap; }
.sv-title      { font-size: 22px; font-weight: 700; color: var(--text-hi); margin: 0 0 4px; }
.sv-sub        { font-size: 13px; color: var(--text-lo); margin: 0; }

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

.prop-section { display: flex; flex-direction: column; gap: var(--sp-2); }
.prop-label   { font-size: 12px; font-weight: 600; color: var(--text-lo); text-transform: uppercase; letter-spacing: 0.05em; }
.prop-bar     { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: var(--bg-raised); border: 1px solid var(--border-line); }
.prop-seg     { transition: width 0.4s ease; min-width: 2px; }
.prop-legend  { display: flex; flex-wrap: wrap; gap: var(--sp-2) var(--sp-4); margin-top: var(--sp-1); }
.legend-item  { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-lo); }
.legend-dot   { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

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

.section-block { display: flex; flex-direction: column; gap: var(--sp-3); }
.section-hd    { display: flex; align-items: center; gap: var(--sp-2); }
.section-title { font-size: 15px; font-weight: 700; color: var(--text-hi); margin: 0; }
.section-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; background: var(--gov-blue); color: white; border-radius: 10px; font-size: 11px; font-weight: 700; }

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

.people-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.people-table th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-lo); border-bottom: 1px solid var(--border-line); }
.people-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-line); }
.pt-name   { font-weight: 600; color: var(--text-hi); }
.pt-phone  { color: var(--text-md); }
.pt-status { font-weight: 700; }
.font-mono { font-family: var(--font-mono); }
.people-pager { display: flex; align-items: center; justify-content: center; gap: var(--sp-3); margin-top: var(--sp-2); }
.people-pager-pos { font-size: 12px; color: var(--text-lo); }
</style>
