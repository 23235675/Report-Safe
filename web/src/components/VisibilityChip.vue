<script setup>
/**
 * VisibilityChip — makes a report's data-exposure tier legible at a glance.
 * One consistent icon + colour for each of the system's privacy tiers
 * (pending / synced / coarse / rescue). See iconography.js VISIBILITY.
 */
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { VISIBILITY } from '../iconography.js';

const props = defineProps({
  tier:  { type: String, required: true },          // 'pending' | 'synced' | 'coarse' | 'rescue'
  short: { type: Boolean, default: false },          // compact label
});

const v = computed(() => VISIBILITY[props.tier] || VISIBILITY.coarse);
</script>

<template>
  <span
    class="vis-chip"
    :title="v.detail"
    :style="{ color: v.colorVar, background: v.dimVar, borderColor: v.borderVar }"
  >
    <AppIcon :name="v.icon" :size="13" />
    {{ short ? v.short : v.label }}
  </span>
</template>

<style scoped>
.vis-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  padding: 2px 8px 2px 6px;
  border: 1px solid;
  border-radius: 20px;
  white-space: nowrap;
}
</style>
