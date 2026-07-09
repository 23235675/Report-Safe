<script setup>
import { computed } from 'vue';
import StatusBadge from './StatusBadge.vue';
import AppIcon from './AppIcon.vue';
import { genderIcon } from '../iconography.js';

const props = defineProps({
  report:    { type: Object,  required: true },
  index:     { type: Number,  required: true },
  highlight: { type: Boolean, default: false },
});

const distance = computed(() =>
  props.report.distance_km != null ? `${props.report.distance_km.toFixed(2)}km` : '—'
);

const coords = computed(() =>
  `${(props.report.lat || 0).toFixed(4)},${(props.report.lng || 0).toFixed(4)}`
);

const priorityClass = computed(() => {
  const p = props.report.priority;
  if (p === 0) return 'p1';
  if (p === 1) return 'p2';
  return '';
});

function relativeTime(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
</script>

<template>
  <div class="triage-row" :class="[priorityClass, { highlight }]">
    <div class="triage-rank">{{ String(index + 1).padStart(2, '0') }}</div>
    <span class="triage-ico"><AppIcon :name="genderIcon(report.gender)" :size="16" /></span>
    <div style="flex: 1; min-width: 0;">
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; flex-wrap: wrap;">
        <span style="font-size: 13px; font-weight: 700; color: var(--text-hi);">{{ report.name }}</span>
        <StatusBadge :status="report.status" :short="true" :bare="true" :icon="false" />
        <span
          v-if="report.reported_by === 'family'"
          class="proxy-tag"
          title="Reported on behalf by a family member"
        ><AppIcon name="people" :size="10" /> Proxy</span>
      </div>
      <div class="muted" style="font-size: 11px; line-height: 1.45;">
        <span class="inline-ico"><AppIcon name="navigate" :size="11" /> {{ distance }}</span>
        · {{ coords }}
        · <span class="inline-ico"><AppIcon name="time" :size="11" /> {{ relativeTime(report.updated_at) }}</span>
        <template v-if="report.medical_notes">
          <br>
          <span class="inline-ico" style="color: var(--need-help);">
            <AppIcon name="medkit" :size="11" />
            {{ report.medical_notes.slice(0, 80) }}{{ report.medical_notes.length > 80 ? '…' : '' }}
          </span>
        </template>
        <template v-if="report.phone"> · <span class="inline-ico"><AppIcon name="call" :size="11" /> {{ report.phone }}</span></template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Proxy marker — text + colour only, no container (matches the bare status
   badge). Uses the app's dedicated proxy colour (var(--gov-blue), as in
   .hub-btn-proxy), distinct from every status colour. */
.proxy-tag {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
  color: var(--gov-blue); text-transform: uppercase;
}
.inline-ico { display: inline-flex; align-items: center; gap: 3px; }
/* Neutral (colourless) gender avatar tile — matches the disaster card icon. */
.triage-ico {
  display: inline-grid; place-items: center;
  width: 28px; height: 28px; border-radius: 2px;
  background: #f0f0f2; color: #5b5c63; flex-shrink: 0; margin-top: 1px;
}
</style>
