<script setup>
import AppIcon from './AppIcon.vue';

defineProps({
  label: { type: String,           required: true },
  value: { type: [Number, String], required: true },
  color: { type: String,           default: 'var(--text-hi)' },
  icon:  { type: String,           default: '' },
});
</script>

<template>
  <div class="stat-card">
    <div class="sc-head">
      <AppIcon v-if="icon" :name="icon" :size="16" :style="{ color }" />
      <div class="label">{{ label }}</div>
    </div>
    <div class="value" :style="{ color }">{{ value }}</div>
  </div>
</template>

<style scoped>
.sc-head { display: flex; align-items: center; gap: 6px; margin-bottom: var(--sp-2); }
.sc-head .label { margin: 0; }
.stat-card .value { margin-bottom: 0; }
</style>
