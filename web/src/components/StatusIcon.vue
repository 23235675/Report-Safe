<script setup>
/**
 * StatusIcon — a status's icon on a dim, status-tinted tile (the "medallion"
 * used as the leading element of report rows). Mirrors the mobile status tile
 * (FamilyScreen statusDot / ReportScreen statusIconWrap).
 */
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { statusIcon, statusColor, statusDim } from '../iconography.js';

const props = defineProps({
  status: { type: String, required: true },
  size:   { type: Number, default: 38 },   // tile size
  icon:   { type: Number, default: 20 },    // glyph size
});

const tile = computed(() => ({
  width:  `${props.size}px`,
  height: `${props.size}px`,
  color:  statusColor(props.status),
  background: statusDim(props.status),
}));
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
