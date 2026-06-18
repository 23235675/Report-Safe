<script setup>
import { computed } from 'vue';
import AppIcon from './AppIcon.vue';
import { DISASTER_ICON } from '../iconography.js';
import { t, disasterTypeLabel } from '../i18n/index.js';

const props = defineProps({
  disaster: { type: Object, required: true },
});
defineEmits(['close']);

const metric = computed(() => {
  if (props.disaster.magnitude != null) return `M${props.disaster.magnitude}`;
  if (props.disaster.severity != null)  return `SEV-${props.disaster.severity}`;
  return '';
});
const icon = computed(() => DISASTER_ICON[props.disaster.type?.toLowerCase()] || 'warning');
</script>

<template>
  <div class="disaster-banner" role="alert" aria-live="assertive">
    <span class="indicator"><AppIcon :name="icon" :size="20" /></span>
    <span>
      <strong>{{ t('banner.active') }}</strong> &mdash; {{ disasterTypeLabel(disaster.type) }}
      <template v-if="metric">&nbsp;{{ metric }}</template>
      <template v-if="disaster.description"> &mdash; {{ disaster.description }}</template>
      <span style="color: var(--text-md);"> &mdash; {{ t('banner.areaAffected') }}</span>
    </span>
    <button class="close-x" :aria-label="t('banner.dismiss')" @click="$emit('close')">
      <AppIcon name="close" :size="14" />
    </button>
  </div>
</template>
