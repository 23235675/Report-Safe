<script setup>
// Analytics dock under the Gov map: status-distribution bars (disaster-scoped
// vs all-data) + the 5-axis risk radar, with a maximize overlay for the radar.
// Receives the two cmd-stats snapshots from GovView; all chart math lives in
// lib/radar.js.
import { computed, ref } from 'vue';
import { STATUS_SHORT, STATUS_COLOR_VIVID } from '../../iconography.js';
import { radarPercentages, radarPoints, radarRings, radarAxisPoints } from '../../lib/radar.js';

const props = defineProps({
  stats:       { type: Object, required: true }, // disaster-scoped (cmdStats)
  statsGlobal: { type: Object, required: true }, // fixed wide radius (cmdStatsGlobal)
});

const STATUS_LABEL = STATUS_SHORT;
const statusColorMap = STATUS_COLOR_VIVID;

// Real status distribution for the analytics dock (no fabricated telemetry).
const distribution = computed(() => [
  { key: 'need_help',           n: props.stats.need_help },
  { key: 'injured',             n: props.stats.injured },
  { key: 'awaiting_response',   n: props.stats.awaiting },
  { key: 'potentially_missing', n: props.stats.pot_missing },
  { key: 'missing',             n: props.stats.missing_only },
  { key: 'safe',                n: props.stats.safe },
]);

const distributionGlobal = computed(() => [
  { key: 'need_help',           n: props.statsGlobal.need_help },
  { key: 'injured',             n: props.statsGlobal.injured },
  { key: 'awaiting_response',   n: props.statsGlobal.awaiting },
  { key: 'potentially_missing', n: props.statsGlobal.pot_missing },
  { key: 'missing',             n: props.statsGlobal.missing_only },
  { key: 'safe',                n: props.statsGlobal.safe },
]);

// ── Radar chart (pure SVG, no charting lib) ──────────────────────
// 5 axes mapped to 0-100%. Two polygons: current disaster vs global baseline.
const RADAR_AXES = ['EMERGENCY NEED', 'MEDICAL LOAD', 'MISSING RISK', 'AWAITING DISPATCH', 'UNACCOUNTED GAP'];
const RC = 100, RR = 80; // viewBox center + max radius

const radarCurrent  = computed(() => radarPoints(radarPercentages(props.stats), RC, RC, RR));
const radarBaseline = computed(() => radarPoints(radarPercentages(props.statsGlobal), RC, RC, RR));
const rings = radarRings([20, 40, 60, 80, 100], RADAR_AXES.length, RC, RC, RR);
const axes  = radarAxisPoints(RADAR_AXES, RC, RC, RR, 14);

const isMaximized = ref(false);
</script>

<template>
  <div class="pane-analytics-dock">
    <!-- LEFT 50%: status distribution bars -->
    <div class="dock-half">
      <div class="card-caption">STATUS DISTRIBUTION — BY DISASTER · {{ stats.total }} RECORDS</div>
      <div class="dist-bar">
        <div
          v-for="seg in distribution"
          :key="seg.key"
          class="dist-seg"
          :style="{ flexGrow: seg.n || 0, background: statusColorMap[seg.key] }"
          :title="`${STATUS_LABEL[seg.key]}: ${seg.n}`"
        ></div>
      </div>
      <div class="card-caption">STATUS DISTRIBUTION — ALL DATA · {{ statsGlobal.total }} RECORDS</div>
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
        <polygon v-for="(ring, i) in rings" :key="i" :points="ring" class="radar-ring" />
        <line v-for="ax in axes" :key="ax.label" :x1="RC" :y1="RC" :x2="ax.x2" :y2="ax.y2" class="radar-spoke" />
        <polygon :points="radarBaseline" class="radar-baseline" />
        <polygon :points="radarCurrent" class="radar-current" />
      </svg>
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
        <polygon v-for="(ring, i) in rings" :key="i" :points="ring" class="radar-ring" />
        <line v-for="ax in axes" :key="ax.label" :x1="RC" :y1="RC" :x2="ax.x2" :y2="ax.y2" class="radar-spoke" />
        <text v-for="ax in axes" :key="ax.label + '-l'" :x="ax.lx" :y="ax.ly" class="radar-label">{{ ax.label }}</text>
        <polygon :points="radarBaseline" class="radar-baseline" />
        <polygon :points="radarCurrent" class="radar-current" />
      </svg>
      <div class="radar-legend">
        <span><i class="sw-current"></i> CURRENT DISASTER</span>
        <span><i class="sw-baseline"></i> GLOBAL BASELINE</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pane-analytics-dock { height:125px; border-top:1px solid #d0d0d0; display:flex; background:#fff; flex-shrink:0; }
.dock-half { flex:0 0 50%; max-width:50%; padding:10px; display:flex; flex-direction:column; gap:6px; overflow:hidden; box-sizing:border-box; }
.dock-half:first-child { border-right:1px solid #d0d0d0; }
.card-caption { font-size:11px; font-weight:700; color:#555; }

/* ── Radar ─────────────────────────────────────────────── */
.radar-half { gap:2px; }
.radar-header { display:flex; align-items:center; justify-content:space-between; }
.radar-max-btn { font-size:11px; font-weight:600; padding:2px 8px; background:#f5f5f5; border:1px solid #d0d0d0; color:#333; cursor:pointer; font-family:inherit; border-radius:2px; }
.radar-max-btn:hover { background:#e8e8e8; }
.radar-svg { flex:1; min-height:0; width:100%; }
.radar-ring { fill:none; stroke:#d0d0d0; stroke-width:0.6; }
.radar-spoke { stroke:#d0d0d0; stroke-width:0.6; }
.radar-baseline { fill:rgba(0,0,0,0.06); stroke:rgba(0,0,0,0.2); stroke-width:1; }
.radar-current { fill:rgba(0,0,0,0.1); stroke:#555; stroke-width:1.5; }
.radar-label { font-size:7px; font-weight:700; fill:#888; text-anchor:middle; dominant-baseline:middle; font-family:inherit; }

.radar-overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; z-index:1000; }
.radar-modal { background:#fff; padding:16px; width:min(560px, 90vw); border:1px solid #d0d0d0; display:flex; flex-direction:column; gap:8px; border-radius:2px; }
.radar-svg-lg { height:440px; }
.radar-legend { display:flex; gap:18px; font-size:11px; font-weight:600; color:#333; justify-content:center; }
.radar-legend i { display:inline-block; width:10px; height:10px; margin-right:4px; vertical-align:middle; }
.radar-legend .sw-current { background:rgba(0,0,0,0.1); border:1.5px solid #555; }
.radar-legend .sw-baseline { background:rgba(0,0,0,0.06); border:1px solid rgba(0,0,0,0.2); }

/* ── Distribution ──────────────────────────────────────── */
.dist-bar { display:flex; height:14px; overflow:hidden; background:#eee; border-radius:2px; }
.dist-seg { height:100%; flex-shrink:0; }
.dist-legend { display:flex; flex-wrap:wrap; gap:4px 10px; font-size:10px; color:#555; }
.dist-legend-item { display:flex; align-items:center; gap:3px; }
.dist-legend-item i { width:6px; height:6px; display:inline-block; border-radius:1px; }
</style>
