<script setup>
/**
 * StatusIcon — a status's icon on a dim, status-tinted tile (the "medallion"
 * used as the leading element of report rows). Mirrors the mobile status tile
 * (FamilyScreen statusDot / ReportScreen statusIconWrap).
 */
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { statusIcon, statusColor, statusDim, STATUS_COLOR_VIVID } from '../iconography.js';

const props = defineProps({
  status: { type: String, required: true },
  size:   { type: Number, default: 38 },   // tile size
  icon:   { type: Number, default: 20 },    // glyph size
  vivid:  { type: Boolean, default: false }, // solid emergency colour (Gov EOC only)
});

const tile = computed(() => props.vivid
  ? { width: `${props.size}px`, height: `${props.size}px`, color: '#fff', background: STATUS_COLOR_VIVID[props.status] || '#6b7280' }
  : { width: `${props.size}px`, height: `${props.size}px`, color: statusColor(props.status), background: statusDim(props.status) }
);
</script>

<template>
  <span class="status-icon" :style="tile">
    <AppIcon :name="statusIcon(status)" :size="icon" />
  </span>
</template>

<style scoped>
.status-icon {
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-md);
  flex-shrink: 0;
}
</style>
