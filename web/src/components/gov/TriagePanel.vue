<script setup>
// TRIAGE tab of the Gov routing pane: a name/phone search + status filter chips
// + the P1/P2/P3 rescue queue. GovView owns the filters and the report lists;
// this panel additionally filters locally by the search box. Exposes
// scrollToReport(id) so the map's marker-click handler can centre a report.
import { ref, computed } from 'vue';
import TriageRow from '../TriageRow.vue';
import AppIcon from '../AppIcon.vue';
import { STATUS_SHORT } from '../../iconography.js';

const props = defineProps({
  p1:            { type: Array, required: true },
  p2:            { type: Array, required: true },
  p3:            { type: Array, required: true },
  statusFilters: { type: Object, required: true },
  highlightId:   { type: String, default: null },
  empty:         { type: Boolean, default: false },
});
defineEmits(['toggle', 'select']);

const STATUS_LABEL = STATUS_SHORT;

// Local free-text filter — matches a report's name OR phone.
const search = ref('');
function matchSearch(r) {
  const q = search.value.trim().toLowerCase();
  if (!q) return true;
  return (r.name || '').toLowerCase().includes(q) || (r.phone || '').toLowerCase().includes(q);
}
const fp1 = computed(() => props.p1.filter(matchSearch));
const fp2 = computed(() => props.p2.filter(matchSearch));
const fp3 = computed(() => props.p3.filter(matchSearch));
const noneMatch = computed(() => fp1.value.length + fp2.value.length + fp3.value.length === 0);

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
    <div class="gov-search">
      <AppIcon name="search" :size="14" />
      <input v-model="search" type="search" placeholder="Search name or phone…" aria-label="Search triage by name or phone" />
    </div>

    <!-- Status filters (core EOC control) -->
    <div class="filter-chip-row">
      <button
        v-for="(on, key) in statusFilters"
        :key="key"
        class="filter-chip"
        :class="{ on }"
        :aria-pressed="on"
        @click="$emit('toggle', key)"
      >{{ STATUS_LABEL[key] }}</button>
    </div>

    <div ref="scrollEl" class="cyber-queue-stack">
      <div v-if="fp1.length > 0" class="queue-category">
        <div class="category-divider text-red">CRITICAL PRIORITY P1 · {{ fp1.length }}</div>
        <div v-for="(r, i) in fp1" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" role="button" tabindex="0" @click="$emit('select', r.id)" @keydown.enter.prevent="$emit('select', r.id)" @keydown.space.prevent="$emit('select', r.id)">
          <TriageRow :report="r" :index="i" :highlight="highlightId === r.id" />
        </div>
      </div>
      <div v-if="fp2.length > 0" class="queue-category">
        <div class="category-divider text-orange">MEDICAL ESCALATION P2 · {{ fp2.length }}</div>
        <div v-for="(r, i) in fp2" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" role="button" tabindex="0" @click="$emit('select', r.id)" @keydown.enter.prevent="$emit('select', r.id)" @keydown.space.prevent="$emit('select', r.id)">
          <TriageRow :report="r" :index="fp1.length + i" :highlight="highlightId === r.id" />
        </div>
      </div>
      <div v-if="fp3.length > 0" class="queue-category">
        <div class="category-divider text-yellow">MONITOR / WELFARE P3 · {{ fp3.length }}</div>
        <div v-for="(r, i) in fp3" :id="`triage-${r.id}`" :key="r.id" class="cyber-queue-item" role="button" tabindex="0" @click="$emit('select', r.id)" @keydown.enter.prevent="$emit('select', r.id)" @keydown.space.prevent="$emit('select', r.id)">
          <TriageRow :report="r" :index="fp1.length + fp2.length + i" :highlight="highlightId === r.id" />
        </div>
      </div>
      <div v-if="noneMatch" class="cyber-empty-notice">No records match current parameters.</div>
    </div>
  </div>
</template>

<style scoped>
.sub-wrapper { display:flex; flex-direction:column; gap:8px; }
.text-red { color:#c0392b; } .text-orange { color:#c2410c; } .text-yellow { color:#9a5f00; }
.filter-chip-row { display:flex; flex-wrap:wrap; gap:4px; }
.filter-chip { font-size:12px; font-weight:500; padding:4px 10px; background:#fff; border:1px solid #e9e9ec; color:#555; cursor:pointer; font-family:inherit; border-radius:2px; }
.filter-chip.on { background:#26262b; color:#fff; border-color:#26262b; }
.cyber-queue-stack { display:flex; flex-direction:column; gap:10px; }
.queue-category { display:flex; flex-direction:column; gap:6px; }
.category-divider { font-size:11px; font-weight:700; letter-spacing:0.03em; padding-bottom:4px; border-bottom:1px solid #e9e9ec; margin-bottom:2px; }
.cyber-queue-item { background:#fff; border:1px solid #d9dbe0; padding:0; overflow:hidden; cursor:pointer; border-radius:3px; box-shadow:0 1px 2px rgba(0,0,0,0.03); }
.cyber-queue-item:hover { border-color:#c4c4ca; }
.cyber-empty-notice { padding:16px; text-align:center; color:#666; font-size:13px; }
</style>
