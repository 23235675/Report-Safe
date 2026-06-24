<script setup>
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { STATUS_BADGE_CLASS, STATUS_COLOR_VIVID, statusIcon } from '../iconography.js';
import { t } from '../i18n/index.js';

const props = defineProps({
  status: { type: String, required: true },
  short:  { type: Boolean, default: false },   // compact label for dense rows
  icon:   { type: Boolean, default: true },     // show the leading status icon
  vivid:  { type: Boolean, default: false },    // solid emergency colour (Gov EOC only)
});

const label = computed(() => {
  const key = `${props.short ? 'statusShort' : 'status'}.${props.status}`;
  const translated = t(key);
  return translated === key ? (props.status || '').replace(/_/g, ' ').toUpperCase() : translated;
});
const cls = computed(() => STATUS_BADGE_CLASS[props.status] || 'badge-missing');
const vividStyle = computed(() => {
  if (!props.vivid) return null;
  const c = STATUS_COLOR_VIVID[props.status] || '#6b7280';
  return { background: c, borderColor: c, color: '#fff' };
});
</script>

<template>
  <span class="badge" :class="cls" :style="vividStyle">
    <AppIcon v-if="icon" :name="statusIcon(status)" :size="12" style="margin-right: 4px;" />
    {{ label }}
  </span>
</template>
