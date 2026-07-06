<script setup>
// TRIAGE tab of the Gov routing pane: status filter chips + the P1/P2/P3
// rescue queue. Stateless — GovView owns the filters and the report lists and
// reacts to @toggle / @select. Exposes scrollToReport(id) so the map's
// marker-click handler can centre the clicked report in the queue.
import { ref } from 'vue';
import TriageRow from '../TriageRow.vue';
import { STATUS_SHORT } from '../../iconography.js';

defineProps({
  p1:            { type: Array, required: true },
  p2:            { type: Array, required: true },
  p3:            { type: Array, required: true },
  statusFilters: { type: Object, required: true },
  highlightId:   { type: String, default: null },
  empty:         { type: Boolean, default: false },
});
defineEmits(['toggle', 'select']);

const STATUS_LABEL = STATUS_SHORT;

const scrollEl = ref(null);
function scrollToReport(id) {
  const el = document.getElementById(`triage-${id}`);
  const scroll = scrollEl.value;
  if (el && scroll) scroll.scrollTop = el.offsetTop - scroll.clientHeight / 2;
}
defineExpose({ scrollToReport });
</script>

<template>
  <div class="sub-wrapper">
    <!-- Status filters (core EOC control) -->
    <div class="filter-chip-row">
      <button
        v-for="(on, key) in statusFilters"
        :key="key"
        class="filter-chip"
        :class="{ on }"
        @click="$emit('toggle', key)"
      >{{ STATUS_LABEL[key] }}</button>
    </div>

    <div ref="scrollEl" class="cyber-queue-stack">
      <div v-if="p1.length > 0" class="queue-category">
        <div class="category-divider text-red">CRITICAL PRIORITY P1 · {{ p1.length }}</div>
        <div v-for="(r, i) in p1" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" @click="$emit('select', r.id)">
          <TriageRow :report="r" :index="i" :highlight="highlightId === r.id" />
        </div>
      </div>
      <div v-if="p2.length > 0" class="queue-category">
        <div class="category-divider text-orange">MEDICAL ESCALATION P2 · {{ p2.length }}</div>
        <div v-for="(r, i) in p2" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" @click="$emit('select', r.id)">
          <TriageRow :report="r" :index="p1.length + i" :highlight="highlightId === r.id" />
        </div>
      </div>
      <div v-if="p3.length > 0" class="queue-category">
        <div class="category-divider text-yellow">MONITOR / WELFARE P3 · {{ p3.length }}</div>
        <div v-for="(r, i) in p3" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" @click="$emit('select', r.id)">
          <TriageRow :report="r" :index="p1.length + p2.length + i" :highlight="highlightId === r.id" />
        </div>
      </div>
      <div v-if="empty" class="cyber-empty-notice">No records match current parameters.</div>
    </div>
  </div>
</template>

<style scoped>
.sub-wrapper { display:flex; flex-direction:column; gap:8px; }
.text-red { color:#222; } .text-orange { color:#222; } .text-yellow { color:#222; }
.filter-chip-row { display:flex; flex-wrap:wrap; gap:4px; }
.filter-chip { font-size:11px; font-weight:500; padding:3px 8px; background:#fff; border:1px solid #d0d0d0; color:#555; cursor:pointer; font-family:inherit; border-radius:2px; }
.filter-chip.on { background:#e8e8e8; color:#222; border-color:#999; }
.cyber-queue-stack { display:flex; flex-direction:column; gap:10px; }
.queue-category { display:flex; flex-direction:column; gap:4px; }
.category-divider { font-size:11px; font-weight:700; padding-bottom:3px; border-bottom:1px solid #d0d0d0; margin-bottom:2px; color:#555; }
.cyber-queue-item { background:#fff; border:1px solid #d0d0d0; padding:4px; cursor:pointer; border-radius:2px; }
.cyber-empty-notice { padding:16px; text-align:center; color:#888; font-size:12px; }
</style>
