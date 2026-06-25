<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { getStats, getPeople } from '../api.js';
import { useSocket } from '../socket.js';
import AppIcon from '../components/AppIcon.vue';
import { t } from '../i18n/index.js';
// Status colours come from the shared vivid palette so the Status Overview
// matches the Gov console and Admin panel exactly.
import { STATUS_COLOR_VIVID } from '../iconography.js';

const CATEGORY_CONFIGS = [
  { key: 'safe',               icon: 'checkmark-circle' },
  { key: 'injured',            icon: 'medkit' },
  { key: 'need_help',          icon: 'alert-circle' },
  { key: 'awaiting_response',  icon: 'time' },
  { key: 'potentially_missing',icon: 'person-remove' },
  { key: 'missing',            icon: 'search' },
  { key: 'verified_missing',   icon: 'warning' },
  { key: 'rescued',            icon: 'shield-checkmark' },
  { key: 'deceased',           icon: 'remove-circle' },
];

const stats = ref({
  total: 0, safe: 0, injured: 0, need_help: 0,
  awaiting_response: 0, potentially_missing: 0, missing: 0,
  verified_missing: 0, rescued: 0, deceased: 0, active_disasters: 0,
});
const people    = ref([]);
const peopleTotal = ref(0);
const peopleOffset = ref(0);
const PEOPLE_PAGE = 50;
const loading   = ref(true);
const error     = ref(false);
// Clicked dashcard → filter the people roster to that one status (null = all).
const activeStatus = ref(null);

function statusLabel(status) { return status ? t(`status.${status}`) : '—'; }
function statusColor(status) { return STATUS_COLOR_VIVID[status] || 'var(--text-lo)'; }
function genderLabel(g) {
  if (g === 'male') return t('statusView.genderMale');
  if (g === 'female') return t('statusView.genderFemale');
  return '—';
}

function selectStatus(key) {
  // Toggle off if the same card is clicked again.
  activeStatus.value = activeStatus.value === key ? null : key;
  peopleOffset.value = 0;
  load();
}
function clearStatus() {
  if (!activeStatus.value) return;
  activeStatus.value = null;
  peopleOffset.value = 0;
  load();
}

const { onStatsUpdate } = useSocket();
let offStats = null;
let lastUpdatedBySocket = 0; // 用於防範 API 覆蓋最新 WebSocket 數據的標記

const pct = (n) => stats.value.total ? Math.round((n / stats.value.total) * 100) : 0;

// 只針對變動的數據與語系進行響應式計算
const categories = computed(() =>
  CATEGORY_CONFIGS.map(cfg => ({
    ...cfg,
    color: STATUS_COLOR_VIVID[cfg.key] || 'var(--text-lo)',
    label: t(`status.${cfg.key}`),
    val: stats.value[cfg.key] || 0
  }))
);

async function load() {
  loading.value = true;
  error.value   = false;
  const requestTime = Date.now();
  try {
    const [r, p] = await Promise.all([getStats(), getPeople({ limit: PEOPLE_PAGE, offset: peopleOffset.value, status: activeStatus.value })]);

    // 只有在 API 回傳比最後一次 WebSocket 更新還要新，或者還沒收到 WebSocket 時才寫入統計
    if (requestTime > lastUpdatedBySocket) {
      stats.value = r.stats || r;
    }
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

      <!-- ── Status breakdown (government data table; click a row to filter) ── -->
      <div class="section-block">
        <div class="section-hd">
          <h2 class="section-title">{{ $t('statusView.breakdown') }}</h2>
          <span class="section-count">{{ stats.total }}</span>
        </div>
        <div class="table-wrap">
          <table class="data-table status-table">
            <thead>
              <tr>
                <th>{{ $t('statusView.colStatus') }}</th>
                <th class="col-num">{{ $t('statusView.colCount') }}</th>
                <th>{{ $t('statusView.colShare') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="cat in categories" :key="cat.key"
                class="status-row" :class="{ 'is-active': activeStatus === cat.key }"
                role="button" tabindex="0"
                @click="selectStatus(cat.key)"
                @keydown.enter.prevent="selectStatus(cat.key)"
                @keydown.space.prevent="selectStatus(cat.key)"
              >
                <td>
                  <span class="st-cell">
                    <span class="st-dot" :style="{ background: cat.color }"></span>
                    <AppIcon :name="cat.icon" :size="14" :style="{ color: cat.color }" />
                    <span class="st-name">{{ cat.label }}</span>
                  </span>
                </td>
                <td class="col-num st-count">{{ cat.val || 0 }}</td>
                <td>
                  <div class="share-cell">
                    <div class="share-bar">
                      <div class="share-fill" :style="{ width: pct(cat.val || 0) + '%', background: cat.color }"></div>
                    </div>
                    <span class="share-pct">{{ pct(cat.val || 0) }}%</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section-block">
        <div class="section-hd">
          <h2 class="section-title">{{ $t('statusView.peopleTitle') }}</h2>
          <span class="section-count">{{ peopleTotal }}</span>
          <template v-if="activeStatus">
            <span class="people-filter" :style="{ color: statusColor(activeStatus) }">
              {{ $t('statusView.filteredBy', { label: statusLabel(activeStatus) }) }}
            </span>
            <button class="btn-secondary btn-sm" @click="clearStatus">
              <AppIcon name="close" :size="13" /> {{ $t('statusView.showAll') }}
            </button>
          </template>
        </div>
        <div v-if="people.length === 0" class="state-block">
          <p class="state-sub">{{ $t('statusView.noPeople') }}</p>
        </div>
        <table v-else class="people-table">
          <thead>
            <tr>
              <th>{{ $t('statusView.colName') }}</th>
              <th>{{ $t('statusView.colPhone') }}</th>
              <th>{{ $t('statusView.colGender') }}</th>
              <th>{{ $t('statusView.colStatus') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in people" :key="p.id">
              <td class="pt-name">{{ p.name }}</td>
              <td class="pt-phone font-mono">{{ p.phone_masked || '—' }}</td>
              <td class="pt-gender">{{ genderLabel(p.gender) }}</td>
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

/* ── Government data tables (shared look with the Shelters tab) ──────── */
.table-wrap { background: var(--bg-panel); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
.data-table th { padding: 8px 12px; text-align: left; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #ffffff; background: var(--accent-hover); border-bottom: 1px solid var(--accent-active); white-space: nowrap; font-family: var(--font-mono); }
.data-table td { padding: 12px 14px; border-bottom: 1px solid var(--border-line); vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--bg-raised); }
.col-num { text-align: right; }

/* Status breakdown rows — clickable to filter the roster below. */
.status-row { cursor: pointer; }
.status-row:focus-visible { outline: 2px solid var(--gov-blue); outline-offset: -2px; }
.status-row.is-active td { background: var(--gov-blue-dim); }
.status-row.is-active td:first-child { box-shadow: inset 3px 0 0 var(--gov-blue); }
.st-cell  { display: inline-flex; align-items: center; gap: 8px; }
.st-dot   { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.st-name  { font-weight: 600; color: var(--text-hi); }
.st-count { font-family: var(--font-mono); font-weight: 700; color: var(--text-hi); }
.share-cell { display: flex; align-items: center; gap: var(--sp-3); }
.share-bar  { flex: 1; max-width: 220px; height: 6px; background: var(--bg-raised); border: 1px solid var(--border-line); border-radius: 3px; overflow: hidden; }
.share-fill { height: 100%; transition: width 0.4s ease; min-width: 2px; }
.share-pct  { font-family: var(--font-mono); font-size: 12px; color: var(--text-lo); width: 42px; text-align: right; }

.section-block { display: flex; flex-direction: column; gap: var(--sp-3); }
.section-hd    { display: flex; align-items: center; gap: var(--sp-2); }
.section-title { font-size: 15px; font-weight: 700; color: var(--text-hi); margin: 0; }
.section-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 6px; background: var(--gov-blue); color: white; border-radius: 10px; font-size: 11px; font-weight: 700; }

/* Reported People — clean, container-free table (previous design). */
.people-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.people-table th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-lo); border-bottom: 1px solid var(--border-line); }
.people-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-line); }
.pt-name   { font-weight: 600; color: var(--text-hi); }
.pt-phone  { color: var(--text-md); }
.pt-gender { color: var(--text-md); }
.people-filter { font-size: 12px; font-weight: 700; margin-left: auto; }
.section-hd .btn-sm { margin-left: var(--sp-2); }
.pt-status { font-weight: 700; }
.font-mono { font-family: var(--font-mono); }
.people-pager { display: flex; align-items: center; justify-content: center; gap: var(--sp-3); margin-top: var(--sp-2); }
.people-pager-pos { font-size: 12px; color: var(--text-lo); }
</style>
