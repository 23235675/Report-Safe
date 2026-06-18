<script setup>
import { computed } from 'vue';
import StatusBadge from './StatusBadge.vue';
import StatusIcon from './StatusIcon.vue';
import AppIcon from './AppIcon.vue';

const props = defineProps({ report: { type: Object, required: true } });

function relativeTime(ts) {
  if (!ts) return 'unknown';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const when   = computed(() => relativeTime(props.report.updated_at));
const coords = computed(() => `~${props.report.coarse_lat}, ${props.report.coarse_lng}`);
</script>

<template>
  <div class="report-card">
    <StatusIcon :status="report.status" :size="40" :icon="20" />
    <div style="flex: 1; min-width: 0;">
      <div style="font-size: 16px; font-weight: 700; color: var(--text-hi); margin-bottom: 4px;">
        {{ report.name }}
        <span
          v-if="report.reported_by === 'family'"
          style="font-size: 11px; font-weight: 600; color: var(--awaiting); margin-left: 6px;"
        >via {{ report.reporter_name || 'family' }}</span>
      </div>
      <div class="muted" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
        <span class="inline-ico"><AppIcon name="time" :size="13" /> {{ when }}</span>
        ·
        <span class="inline-ico"><AppIcon name="globe" :size="13" /> {{ coords }}</span>
      </div>
    </div>
    <StatusBadge :status="report.status" />
  </div>
</template>
