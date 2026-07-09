<script setup>
/**
 * AdminChart — renders one admin dashboard chart from a `spec`, at two sizes.
 * Used both in the Overview card grid (size="sm") and the click-to-enlarge
 * pop-up modal (size="lg"). Chart forms: donut, gauge, horizontal bars,
 * vertical bars. All pure SVG/CSS — no charting lib (matches gov CommandStats).
 *
 * spec = {
 *   type: 'donut' | 'gauge' | 'hbar' | 'vbar',
 *   centerN, centerL,        // donut/gauge centre text
 *   segments: [{key,color,dash,offset}],   // donut arcs
 *   pct,                     // gauge arc (0-100)
 *   bars: [{key,label,n,pct?,h?,color?}],  // hbar (pct) / vbar (h)
 *   legend: [{label,val,color}],           // donut/gauge legend
 * }
 */
defineProps({
  spec: { type: Object, required: true },
  size: { type: String, default: 'sm' }, // 'sm' (card) | 'lg' (modal)
});
</script>

<template>
  <div :class="['acx', size === 'lg' ? 'acx-lg' : 'acx-sm']">
    <!-- Donut (composition) / gauge (single ratio) -->
    <div v-if="spec.type === 'donut' || spec.type === 'gauge'" class="donut-wrap">
      <svg class="donut-svg" viewBox="0 0 42 42" role="img" :aria-label="spec.centerL">
        <circle class="donut-track" cx="21" cy="21" r="15.9155" fill="none" stroke="#f0f0f2" stroke-width="4.5" />
        <circle v-if="spec.type === 'gauge'" class="donut-seg" cx="21" cy="21" r="15.9155" fill="none" stroke="#26262b" stroke-width="4.5" :stroke-dasharray="`${spec.pct} ${100 - spec.pct}`" stroke-dashoffset="25" />
        <circle v-else v-for="s in spec.segments" :key="s.key" class="donut-seg" cx="21" cy="21" r="15.9155" fill="none" :stroke="s.color" stroke-width="4.5" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" />
        <text x="21" y="20.5" class="donut-c-n">{{ spec.centerN }}</text>
        <text x="21" y="25.6" class="donut-c-l">{{ spec.centerL }}</text>
      </svg>
      <div class="donut-legend">
        <div v-for="l in spec.legend" :key="l.label" class="dleg-row">
          <span class="dleg-dot" :style="{ background: l.color }"></span>
          <span class="dleg-label">{{ l.label }}</span>
          <span class="dleg-val">{{ l.val }}</span>
        </div>
      </div>
    </div>

    <!-- Horizontal bars -->
    <div v-else-if="spec.type === 'hbar'" class="bars">
      <div class="bar-row" v-for="b in spec.bars" :key="b.key" :title="`${b.label}: ${b.n}`">
        <span class="bar-cat">{{ b.label }}</span>
        <div class="bar-track"><div class="bar-fill" :style="{ width: b.pct + '%', background: b.color || '#26262b' }"></div></div>
        <span class="bar-val">{{ b.n }}</span>
      </div>
    </div>

    <!-- Vertical bars -->
    <div v-else-if="spec.type === 'vbar'" class="vbars">
      <div class="vbar-col" v-for="b in spec.bars" :key="b.key" :title="`${b.label}: ${b.n}`">
        <span class="vbar-val">{{ b.n }}</span>
        <div class="vbar-track"><div class="vbar-fill" :style="{ height: b.h + '%' }"></div></div>
        <span class="vbar-cat">{{ b.label }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; }
.acx { font-family: var(--font-ui); width: 100%; }

/* ── Donut / gauge ── */
.donut-wrap { display:flex; align-items:center; gap:20px; flex-wrap:wrap; justify-content:center; }
.acx-lg .donut-wrap { gap:34px; }
.donut-svg { flex-shrink:0; }
.acx-sm .donut-svg { width:118px; height:118px; }
.acx-lg .donut-svg { width:230px; height:230px; }
.donut-c-n { fill:#1e1e22; font-family:var(--font-mono); font-weight:700; font-size:7.5px; text-anchor:middle; dominant-baseline:central; }
.donut-c-l { fill:#9a9ba3; font-size:2.6px; text-anchor:middle; dominant-baseline:central; text-transform:uppercase; letter-spacing:0.08em; }
.donut-legend { display:flex; flex-direction:column; gap:6px; min-width:130px; }
.acx-lg .donut-legend { gap:11px; min-width:190px; }
.dleg-row { display:grid; grid-template-columns:12px 1fr auto; align-items:center; gap:8px; font-size:12px; }
.acx-lg .dleg-row { grid-template-columns:14px 1fr auto; gap:9px; font-size:13px; }
.dleg-dot { width:10px; height:10px; border-radius:3px; }
.acx-lg .dleg-dot { width:11px; height:11px; }
.dleg-label { color:#5b5c63; font-weight:500; }
.dleg-val { color:#1e1e22; font-weight:700; font-family:var(--font-mono); font-size:12px; }

/* ── Horizontal bars ── */
.bars { display:flex; flex-direction:column; gap:11px; }
.acx-lg .bars { gap:16px; }
.bar-row { display:grid; grid-template-columns:84px 1fr 30px; align-items:center; gap:9px; }
.acx-lg .bar-row { grid-template-columns:100px 1fr 36px; gap:10px; }
.bar-cat { font-size:12px; color:#5b5c63; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bar-track { height:10px; background:#f0f0f2; border-radius:2px; overflow:hidden; }
.acx-lg .bar-track { height:14px; }
.bar-fill { height:100%; border-radius:2px; min-width:0; }
.bar-row:hover .bar-fill { filter:brightness(0.9); }
.bar-val { font-size:12.5px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); text-align:right; }

/* ── Vertical bars ── */
.vbars { display:flex; align-items:flex-end; gap:16px; padding-top:6px; }
.acx-sm .vbars { height:132px; }
.acx-lg .vbars { height:300px; gap:26px; }
.vbar-col { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; gap:6px; height:100%; justify-content:flex-end; }
.acx-lg .vbar-col { gap:8px; }
.vbar-val { font-size:12.5px; font-weight:700; color:#1e1e22; font-family:var(--font-mono); }
.vbar-track { width:38px; max-width:70%; flex:1; min-height:0; display:flex; align-items:flex-end; background:#f0f0f2; border-radius:2px 2px 0 0; overflow:hidden; }
.acx-lg .vbar-track { width:52px; }
.vbar-fill { width:100%; background:#26262b; border-radius:2px 2px 0 0; min-height:0; }
.vbar-col:hover .vbar-fill { filter:brightness(0.9); }
.vbar-cat { font-size:11.5px; color:#5b5c63; font-weight:500; }
</style>
