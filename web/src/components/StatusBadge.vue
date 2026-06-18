<script setup>
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { STATUS_BADGE_CLASS, statusIcon } from '../iconography.js';
import { t } from '../i18n/index.js';

const props = defineProps({
  status: { type: String, required: true },
  short:  { type: Boolean, default: false },   // compact label for dense rows
  icon:   { type: Boolean, default: true },     // show the leading status icon
});

const label = computed(() => {
  const key = `${props.short ? 'statusShort' : 'status'}.${props.status}`;
  const translated = t(key);
  return translated === key ? (props.status || '').replace(/_/g, ' ').toUpperCase() : translated;
});
const cls = computed(() => STATUS_BADGE_CLASS[props.status] || 'badge-missing');
</script>

<template>
  <span class="badge" :class="cls">
    <AppIcon v-if="icon" :name="statusIcon(status)" :size="12" style="margin-right: 4px;" />
    {{ label }}
  </span>
</template>
