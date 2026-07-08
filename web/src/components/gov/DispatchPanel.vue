<script setup>
// DISPATCH tab (CFR 999): the dispatch-unit form + active incident list.
// Owns the form fields locally (GovView keeps it alive with v-show so entries
// persist across tab switches, as before); GovView performs the actual API
// calls and passes busy/msg/incidents back down.
import { ref, computed } from 'vue';
import AppIcon from '../AppIcon.vue';

const props = defineProps({
  incidents: { type: Array, required: true },
  busy:      { type: Boolean, default: false },
  msg:       { type: Object, default: null },
  center:    { type: Object, required: true }, // live map centre { lat, lng }
});
const emit = defineEmits(['dispatch', 'stand-down']);

const INCIDENT_TYPES = [
  { v: 'cardiac_arrest', label: 'Cardiac arrest' },
  { v: 'fire',           label: 'Fire' },
  { v: 'trauma',         label: 'Trauma' },
  { v: 'other',          label: 'Other' },
];

const form = ref({ type: 'cardiac_arrest', lat: '', lng: '', is_public: true });

function useMapCenter() {
  form.value.lat = props.center.lat.toFixed(5);
  form.value.lng = props.center.lng.toFixed(5);
}

function dispatch() { emit('dispatch', { ...form.value }); }

// Local free-text filter over the active-incident board (matches the type).
const search = ref('');
const filteredIncidents = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return props.incidents;
  return props.incidents.filter((inc) => (inc.type || '').toLowerCase().includes(q));
});
</script>

<template>
  <div class="sub-wrapper cyber-form-layout">
    <div class="form-title">DISPATCH UNIT</div>
    <p class="dispatch-intro">
      Send a 999 / Community-First-Responder alert. Pick an emergency type + location;
      nearby opted-in volunteers with the matching skill (CPR for cardiac / trauma, fire
      crews for fires) are alerted to help in the minutes before the ambulance arrives.
      Residential incidents reach verified responders only.
    </p>
    <div class="field-wrap">
      <label for="dispatch-type">Incident Type</label>
      <select id="dispatch-type" v-model="form.type" class="cyber-select">
        <option v-for="it in INCIDENT_TYPES" :key="it.v" :value="it.v">{{ it.label }}</option>
      </select>
    </div>
    <div class="field-row-split">
      <div class="field-wrap">
        <label for="dispatch-lat">Lat</label>
        <input id="dispatch-lat" v-model="form.lat" class="cyber-field" />
      </div>
      <div class="field-wrap">
        <label for="dispatch-lng">Lng</label>
        <input id="dispatch-lng" v-model="form.lng" class="cyber-field" />
      </div>
    </div>
    <label class="topology-checkbox-item">
      <input type="checkbox" v-model="form.is_public" />
      <span>Public place (residential → verified responders only)</span>
    </label>
    <button class="cyber-btn-dim" @click="useMapCenter">USE MAP CENTER</button>
    <button class="cyber-btn-bright" :disabled="busy" @click="dispatch">{{ busy ? 'DISPATCHING…' : 'DISPATCH' }}</button>
    <div v-if="msg" class="form-feedback-banner" :class="msg.level" role="alert">{{ msg.text }}</div>

    <div class="form-title" style="margin-top:14px;">ACTIVE INCIDENTS · {{ incidents.length }}</div>
    <p class="dispatch-intro" style="margin-top:-2px;">Live board of dispatched incidents — location and how many responders are alerted, en route, and on scene.</p>
    <div class="gov-search">
      <AppIcon name="search" :size="14" />
      <input v-model="search" type="search" placeholder="Search incident type…" aria-label="Search incidents by type" />
    </div>
    <div v-for="inc in filteredIncidents" :key="inc.id" class="cyber-list-row" style="cursor:default;">
      <div class="row-flex-meta">
        <strong>{{ inc.type }}<span v-if="!inc.is_public"> · residential</span></strong>
        <button class="cyber-btn-dim" style="padding:2px 6px;" @click="$emit('stand-down', inc.id)">STAND DOWN</button>
      </div>
      <div class="row-flex-desc">
        {{ inc.lat.toFixed(4) }}, {{ inc.lng.toFixed(4) }}
        · {{ inc.responder_counts.responders }} resp · {{ inc.responder_counts.enroute }} en route · {{ inc.responder_counts.onscene }} on scene
      </div>
    </div>
    <div v-if="filteredIncidents.length === 0" class="cyber-empty-notice">No active incidents.</div>
  </div>
</template>

<style scoped>
.sub-wrapper { display:flex; flex-direction:column; gap:8px; }
.cyber-form-layout { display:flex; flex-direction:column; gap:8px; }
.form-title { font-size:12px; font-weight:700; color:#555; }
.dispatch-intro { font-size:11.5px; line-height:1.5; color:#6f727a; margin:0 0 2px; }
.field-wrap { display:flex; flex-direction:column; gap:3px; min-width:0; }
.field-wrap label { font-size:12px; color:#555; font-weight:600; }
.cyber-select, .cyber-field { width:100%; min-width:0; box-sizing:border-box; background:#fff; border:1px solid #dedee2; padding:7px 9px; color:#222; font-family:inherit; font-size:13px; border-radius:8px; }
.cyber-select:focus, .cyber-field:focus { border-color:#999; }
.field-row-split { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.cyber-btn-bright { background:#26262b; color:#fff; border:none; padding:9px; font-weight:700; cursor:pointer; font-family:inherit; font-size:12px; border-radius:8px; }
.cyber-btn-bright:hover { background:#131316; }
.cyber-btn-dim { background:#f5f5f5; color:#333; border:1px solid #dedee2; padding:7px; font-size:12px; cursor:pointer; font-family:inherit; border-radius:8px; }
.form-feedback-banner { font-size:13px; padding:7px 9px; background:#fff; border:1px solid #dedee2; border-radius:8px; }
.form-feedback-banner.error { color:#c0392b; }
.form-feedback-banner.warn { color:#9a5f00; }
.topology-checkbox-item { display:flex; align-items:center; gap:5px; font-size:12px; color:#555; cursor:pointer; }
.topology-checkbox-item input[type="checkbox"] { accent-color:#26262b; }
.cyber-list-row { padding:8px 10px; border:1px solid #dedee2; border-radius:10px; margin-bottom:6px; cursor:pointer; background:#fff; }
.row-flex-meta { display:flex; justify-content:space-between; align-items:center; font-size:13px; color:#222; }
.row-flex-desc { font-size:12px; color:#666; margin-top:2px; }
.cyber-empty-notice { padding:16px; text-align:center; color:#666; font-size:13px; }
</style>
