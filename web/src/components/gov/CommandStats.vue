<script setup>
// Analytics dock under the Gov map — same light chrome as the rest of the gov
// view (white surface, hairline borders, muted captions, charcoal accents):
//   • STATUS DISTRIBUTION: monochrome-grey vertical bar chart (+ maximize)
//   • RISK RADAR: 5-axis SVG radar (+ maximize)
//   • a top collapse rail so the whole dock can be hidden to give the map room.
// Receives the two cmd-stats snapshots from GovView; radar math lives in lib/radar.js.
import { computed, ref } from 'vue';
import { STATUS_SHORT } from '../../iconography.js';
import { radarPercentages, radarPoints, radarRings, radarAxisPoints } from '../../lib/radar.js';
import { useFocusTrap } from '../../composables/useFocusTrap.js';
import AppIcon from '../AppIcon.vue';

const props = defineProps({
  stats:       { type: Object, required: true }, // disaster-scoped (cmdStats)
  statsGlobal: { type: Object, required: true }, // fixed wide radius (cmdStatsGlobal)
});

const STATUS_LABEL = STATUS_SHORT;

// Real status distribution (no fabricated telemetry).
const distribution = computed(() => [
  { key: 'injured',             n: props.stats.injured },
  { key: 'need_help',           n: props.stats.need_help },
  { key: 'missing',             n: props.stats.missing_only },
  { key: 'potentially_missing', n: props.stats.pot_missing },
  { key: 'awaiting_response',   n: props.stats.awaiting },
  { key: 'safe',                n: props.stats.safe },
]);
const distributionGlobal = computed(() => [
  { key: 'injured',             n: props.statsGlobal.injured },
  { key: 'need_help',           n: props.statsGlobal.need_help },
  { key: 'missing',             n: props.statsGlobal.missing_only },
  { key: 'potentially_missing', n: props.statsGlobal.pot_missing },
  { key: 'awaiting_response',   n: props.statsGlobal.awaiting },
  { key: 'safe',                n: props.statsGlobal.safe },
]);

// Bar scaling: tallest bar = maxPx, everything else proportional (min 2px so a
// non-zero count is always visible). distMax scales the compact single series;
// distMaxAll scales the maximized grouped (current vs all-data) view.
const distMax    = computed(() => Math.max(1, ...distribution.value.map((d) => Number(d.n) || 0)));
const distMaxAll = computed(() => Math.max(1,
  ...distribution.value.map((d) => Number(d.n) || 0),
  ...distributionGlobal.value.map((d) => Number(d.n) || 0)));
const distMaxGlobal = computed(() => Math.max(1, ...distributionGlobal.value.map((d) => Number(d.n) || 0)));
function barPx(n, max, maxPx) { return Math.max(2, Math.round(((Number(n) || 0) / max) * maxPx)); }
// Horizontal-bar width as a % of the track — 0 stays empty, non-zero gets ≥6% so it reads.
function distPct(n, max) { const v = Number(n) || 0; return v <= 0 ? 0 : Math.max(6, Math.round((v / max) * 100)); }

// ── Radar chart (pure SVG) — 5 axes mapped to 0-100%; current vs global. ──
const RADAR_AXES = ['EMERGENCY NEED', 'MEDICAL LOAD', 'MISSING RISK', 'AWAITING DISPATCH', 'UNACCOUNTED GAP'];
const RC = 100, RR = 80; // viewBox center + max radius
const radarCurrent  = computed(() => radarPoints(radarPercentages(props.stats), RC, RC, RR));
const radarBaseline = computed(() => radarPoints(radarPercentages(props.statsGlobal), RC, RC, RR));
const rings = radarRings([20, 40, 60, 80, 100], RADAR_AXES.length, RC, RC, RR);
const axes  = radarAxisPoints(RADAR_AXES, RC, RC, RR, 14);

// ── UI state ──
const collapsed   = ref(false); // whole dock hidden to a thin rail
const isMaximized = ref(false); // radar overlay
const isDistMax   = ref(false); // distribution overlay

// Focus traps for each overlay (Tab cycles inside, Esc closes).
const radarModalEl = ref(null);
useFocusTrap(radarModalEl, isMaximized, () => { isMaximized.value = false; });
const distModalEl = ref(null);
useFocusTrap(distModalEl, isDistMax, () => { isDistMax.value = false; });
</script>

<template>
  <div class="pane-analytics-dock" :class="{ 'is-collapsed': collapsed }">
    <!-- Top-edge collapse rail — hides the whole dock so the map gets the room. -->
    <button
      class="dock-rail"
      :aria-expanded="String(!collapsed)"
      :title="collapsed ? 'Show analytics dock' : 'Hide analytics dock'"
      @click="collapsed = !collapsed"
    >
      <span class="rail-label">ANALYTICS</span>
      <AppIcon name="chevron-down" :size="15" class="rail-chevron" :class="{ flip: collapsed }" />
      <span class="rail-label rail-label-r">{{ collapsed ? 'SHOW' : 'HIDE' }}</span>
    </button>

    <div v-if="!collapsed" class="dock-body">
      <!-- LEFT: status distribution — per-disaster (top) + all data (under) -->
      <div class="dock-half">
        <div class="half-head">
          <span class="card-caption">STATUS DISTRIBUTION</span>
          <button class="max-btn" title="Maximize" aria-label="Maximize status distribution" @click="isDistMax = true"><AppIcon name="add" :size="15" /></button>
        </div>
        <div class="dist-lr">
          <div class="hbar-labels">
            <span class="hbar-cap-sp"></span>
            <span v-for="seg in distribution" :key="'l' + seg.key" class="hbar-lbl">{{ STATUS_LABEL[seg.key] }}</span>
          </div>
          <div class="hbar-chart">
            <span class="hbar-cap">PER DISASTER · {{ stats.total }}</span>
            <div v-for="seg in distribution" :key="'p' + seg.key" class="hbar-track" :title="`${STATUS_LABEL[seg.key]}: ${seg.n}`">
              <div class="hbar-fill light" :style="{ width: distPct(seg.n, distMax) + '%' }"><span class="hbar-n">{{ seg.n }}</span></div>
            </div>
          </div>
          <div class="hbar-vline"></div>
          <div class="hbar-chart">
            <span class="hbar-cap">ALL DATA · {{ statsGlobal.total }}</span>
            <div v-for="seg in distributionGlobal" :key="'a' + seg.key" class="hbar-track" :title="`${STATUS_LABEL[seg.key]}: ${seg.n}`">
              <div class="hbar-fill dark" :style="{ width: distPct(seg.n, distMaxGlobal) + '%' }"><span class="hbar-n">{{ seg.n }}</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: radar chart -->
      <div class="dock-half radar-half">
        <div class="half-head">
          <span class="card-caption">RISK RADAR</span>
          <button class="max-btn" title="Maximize" aria-label="Maximize risk radar" @click="isMaximized = true"><AppIcon name="add" :size="15" /></button>
        </div>
        <svg class="radar-svg" viewBox="-52 -10 294 200" preserveAspectRatio="xMidYMid meet">
          <polygon v-for="(ring, i) in rings" :key="i" :points="ring" class="radar-ring" />
          <line v-for="ax in axes" :key="ax.label" :x1="RC" :y1="RC" :x2="ax.x2" :y2="ax.y2" class="radar-spoke" />
          <text v-for="ax in axes" :key="ax.label + '-l'" :x="ax.lx" :y="ax.ly" class="radar-label">{{ ax.label }}</text>
          <polygon :points="radarBaseline" class="radar-baseline" />
          <polygon :points="radarCurrent" class="radar-current" />
        </svg>
        <div class="radar-legend-row">
          <span><i class="rk-sw rk-cur"></i>CURRENT</span>
          <span><i class="rk-sw rk-base"></i>GLOBAL</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Status-distribution maximize overlay -->
  <div v-if="isDistMax" class="max-overlay" @click.self="isDistMax = false">
    <div ref="distModalEl" class="max-modal" role="dialog" aria-modal="true" aria-labelledby="dist-modal-title" tabindex="-1">
      <div class="max-head">
        <span id="dist-modal-title" class="card-caption">STATUS DISTRIBUTION — CURRENT vs ALL DATA</span>
        <button class="max-btn" title="Close" aria-label="Close" @click="isDistMax = false"><AppIcon name="close" :size="16" /></button>
      </div>
      <div class="bar-chart-lg">
        <div v-for="(seg, i) in distribution" :key="seg.key" class="bar-group">
          <div class="bar-pair">
            <div class="bar-fill-lg cur" :style="{ height: barPx(seg.n, distMaxAll, 210) + 'px' }"><span class="bar-val-lg">{{ seg.n }}</span></div>
            <div class="bar-fill-lg all" :style="{ height: barPx(distributionGlobal[i].n, distMaxAll, 210) + 'px' }"><span class="bar-val-lg">{{ distributionGlobal[i].n }}</span></div>
          </div>
          <span class="bar-label-lg">{{ STATUS_LABEL[seg.key] }}</span>
        </div>
      </div>
      <div class="max-legend">
        <span><i class="sw cur"></i> CURRENT DISASTER · {{ stats.total }}</span>
        <span><i class="sw all"></i> ALL DATA · {{ statsGlobal.total }}</span>
      </div>
    </div>
  </div>

  <!-- Risk-radar maximize overlay -->
  <div v-if="isMaximized" class="max-overlay" @click.self="isMaximized = false">
    <div ref="radarModalEl" class="max-modal" role="dialog" aria-modal="true" aria-labelledby="radar-modal-title" tabindex="-1">
      <div class="max-head">
        <span id="radar-modal-title" class="card-caption">RISK RADAR — CURRENT vs GLOBAL</span>
        <button class="max-btn" title="Close" aria-label="Close" @click="isMaximized = false"><AppIcon name="close" :size="16" /></button>
      </div>
      <svg class="radar-svg radar-svg-lg" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
        <polygon v-for="(ring, i) in rings" :key="i" :points="ring" class="radar-ring" />
        <line v-for="ax in axes" :key="ax.label" :x1="RC" :y1="RC" :x2="ax.x2" :y2="ax.y2" class="radar-spoke" />
        <text v-for="ax in axes" :key="ax.label + '-l'" :x="ax.lx" :y="ax.ly" class="radar-label">{{ ax.label }}</text>
        <polygon :points="radarBaseline" class="radar-baseline" />
        <polygon :points="radarCurrent" class="radar-current" />
      </svg>
      <div class="max-legend">
        <span><i class="sw cur"></i> CURRENT DISASTER</span>
        <span><i class="sw all"></i> GLOBAL BASELINE</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Same light chrome as the rest of the gov view — white surface, hairline
   #e9e9ec borders, muted #8a8b93 captions, charcoal #26262b accents. The
   distribution bars stay monochrome (gov greys #8a8b93 / #5b5c63). */
.pane-analytics-dock { background:#ebecef; border-top:1px solid #d9dbe0; flex-shrink:0; display:flex; flex-direction:column; }

.dock-rail { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; height:22px; padding:0; background:#ebecef; border:none; border-bottom:1px solid #d9dbe0; color:#8a8b93; cursor:pointer; font-family:inherit; }
.dock-rail:hover { background:#e2e4e8; color:#5b5c63; }
.rail-label { font-size:9.5px; font-weight:700; letter-spacing:0.14em; color:inherit; }
.rail-label-r { opacity:.9; }
.rail-chevron { color:inherit; }
.rail-chevron.flip { transform:rotate(180deg); }
.is-collapsed .dock-rail { border-bottom:none; }

.dock-body { display:flex; height:190px; }
.dock-half { flex:0 0 50%; max-width:50%; padding:8px 12px; display:flex; flex-direction:column; gap:5px; overflow:hidden; box-sizing:border-box; }
.dock-half:first-child { border-right:1px solid #d9dbe0; }
.half-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.card-caption { font-size:10px; font-weight:700; color:#8a8b93; letter-spacing:0.05em; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* Small square "+" / "×" icon button (maximize / close) — gov secondary style. */
.max-btn { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; padding:0; flex-shrink:0; background:#fff; border:1px solid #dedee2; border-radius:7px; color:#5b5c63; cursor:pointer; font-family:inherit; }
.max-btn:hover { background:#f3f3f5; border-color:#c4c4ca; color:#1e1e22; }

/* ── Distribution — PER DISASTER (left, light grey) │ ALL DATA (right, dark grey) ──
   Horizontal bars grow from the left; shared status labels down the left; a
   single vertical divider line between the two charts. Count pops on hover. */
.dist-lr { flex:1; min-height:0; display:flex; align-items:stretch; gap:7px; }
.hbar-labels { flex:0 0 56px; display:flex; flex-direction:column; }
.hbar-chart { flex:1; min-width:0; display:flex; flex-direction:column; }
.hbar-vline { flex:0 0 1px; align-self:stretch; background:#d9dbe0; }
.hbar-cap { height:13px; flex-shrink:0; font-size:8px; font-weight:700; color:#6f727a; letter-spacing:0.03em; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hbar-cap-sp { height:13px; flex-shrink:0; }
.hbar-lbl { flex:1; min-height:0; display:flex; align-items:center; justify-content:flex-end; font-size:8px; font-weight:600; color:#6f727a; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hbar-track { flex:1; min-height:0; display:flex; align-items:center; }
.hbar-fill { position:relative; height:9px; min-width:0; border-radius:0 3px 3px 0; }
.hbar-fill.light { background:#9a9da3; }
.hbar-fill.dark  { background:#55585f; }
.hbar-track:hover .hbar-fill.light { background:#83868d; }
.hbar-track:hover .hbar-fill.dark  { background:#3f424a; }
.hbar-n { position:absolute; left:100%; top:50%; transform:translateY(-50%); margin-left:4px; font-size:8px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); opacity:0; white-space:nowrap; z-index:2; }
.hbar-track:hover .hbar-n { opacity:1; }

/* ── Radar (same light treatment as the gov chrome) ────────────────── */
.radar-half { gap:2px; }
.radar-svg { flex:1; min-height:0; width:100%; }
/* Axis labels placed on the compact radar — larger than the maximize's so they
   stay legible when the whole radar is shrunk into the dock. */
.radar-half .radar-svg .radar-label { font-size:12px; }
.radar-legend-row { display:flex; justify-content:center; gap:16px; flex-shrink:0; padding-top:1px; }
.radar-legend-row span { display:flex; align-items:center; gap:4px; font-size:8px; font-weight:700; color:#5b5c63; letter-spacing:0.02em; }
.rk-sw { width:9px; height:9px; flex-shrink:0; border-radius:2px; }
.rk-cur { background:rgba(38,38,43,0.16); border:1.5px solid #26262b; }
.rk-base { background:rgba(0,0,0,0.06); border:1px solid rgba(0,0,0,0.3); }
.radar-ring { fill:none; stroke:#d3d5da; stroke-width:0.6; }
.radar-spoke { stroke:#d3d5da; stroke-width:0.6; }
.radar-baseline { fill:rgba(0,0,0,0.05); stroke:rgba(0,0,0,0.22); stroke-width:1; }
.radar-current { fill:rgba(38,38,43,0.10); stroke:#26262b; stroke-width:1.5; }
.radar-label { font-size:7px; font-weight:700; fill:#8a8b93; text-anchor:middle; dominant-baseline:middle; font-family:inherit; }

/* ── Maximize overlays — white modals like the rest of the app ─────── */
.max-overlay { position:fixed; inset:0; background:rgba(20,20,24,.42); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; }
.max-modal { background:#fff; padding:18px; width:min(620px, 92vw); border:1px solid #e9e9ec; display:flex; flex-direction:column; gap:14px; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,0.22); }
.max-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.max-head .card-caption { font-size:12px; color:#5b5c63; letter-spacing:0.04em; }
.radar-svg-lg { flex:0 0 auto; width:100%; height:270px; }

.max-legend { display:flex; gap:20px; font-size:12px; font-weight:600; color:#5b5c63; justify-content:center; }
.max-legend i.sw { display:inline-block; width:11px; height:11px; margin-right:5px; vertical-align:middle; border-radius:2px; }
.max-legend .sw.cur { background:#8a8b93; }
.max-legend .sw.all { background:#5b5c63; }

/* Grouped (current vs all-data) large bar chart. */
.bar-chart-lg { display:flex; align-items:flex-end; justify-content:space-around; gap:14px; height:270px; padding:20px 4px 0; border-bottom:1px solid #e9e9ec; }
.bar-group { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:8px; height:100%; justify-content:flex-end; }
.bar-pair { display:flex; align-items:flex-end; justify-content:center; gap:5px; flex:1; min-height:0; width:100%; }
.bar-fill-lg { width:26px; max-width:40%; border-radius:4px 4px 0 0; display:flex; align-items:flex-start; justify-content:center; position:relative; }
.bar-fill-lg.cur { background:#8a8b93; }
.bar-fill-lg.all { background:#5b5c63; }
.bar-val-lg { position:absolute; top:-16px; font-size:11px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); }
.bar-label-lg { font-size:10px; font-weight:600; color:#8a8b93; text-transform:uppercase; letter-spacing:0.03em; text-align:center; white-space:nowrap; }
</style>
