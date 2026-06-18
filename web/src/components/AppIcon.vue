<script setup>
/**
 * AppIcon — the single icon primitive for the web app.
 *
 * Renders an inline 24×24 SVG from the shared ICONS dictionary (icons.js),
 * which is named to match the mobile app's Ionicons vocabulary. Colour comes
 * from `currentColor`, so callers tint an icon simply by setting CSS `color`
 * (typically a status token). This is what keeps a "need help" report red and
 * alert-circle-shaped on BOTH surfaces.
 *
 *   <AppIcon name="alert-circle" :size="18" style="color: var(--need-help)" />
 */
import { computed } from 'vue';
import { ICONS } from './icons.js';

const props = defineProps({
  name:  { type: String, required: true },
  size:  { type: [Number, String], default: 20 },
  // Provide a label to expose the icon to assistive tech; omit for decorative.
  title: { type: String, default: '' },
});

const inner = computed(() => ICONS[props.name] || ICONS.ellipse);
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :aria-hidden="title ? 'false' : 'true'"
    :role="title ? 'img' : undefined"
    :aria-label="title || undefined"
    focusable="false"
  >
    <title v-if="title">{{ title }}</title>
    <g v-html="inner" />
  </svg>
</template>

<style scoped>
.app-icon {
  display: inline-block;
  vertical-align: middle;
  flex-shrink: 0;
}
</style>
