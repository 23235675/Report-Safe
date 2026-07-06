<script setup>
// DISPATCH tab (CFR 999): the dispatch-unit form + active incident list.
// Owns the form fields locally (GovView keeps it alive with v-show so entries
// persist across tab switches, as before); GovView performs the actual API
// calls and passes busy/msg/incidents back down.
import { ref } from 'vue';

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
</script>

<template>
  <div class="sub-wrapper cyber-form-layout">
    <div class="form-title">DISPATCH UNIT</div>
    <div class="field-wrap">
      <label>Incident Type</label>
      <select v-model="form.type" class="cyber-select">
        <option v-for="it in INCIDENT_TYPES" :key="it.v" :value="it.v">{{ it.label }}</option>
      </select>
    </div>
    <div class="field-row-split">
      <div class="field-wrap">
        <label>Lat</label>
        <input v-model="form.lat" class="cyber-field" />
      </div>
      <div class="field-wrap">
        <label>Lng</label>
        <input v-model="form.lng" class="cyber-field" />
      </div>
    </div>
    <label class="topology-checkbox-item">
      <input type="checkbox" v-model="form.is_public" />
      <span>Public place (residential → verified responders only)</span>
    </label>
    <button class="cyber-btn-dim" @click="useMapCenter">USE MAP CENTER</button>
    <button class="cyber-btn-bright" :disabled="busy" @click="dispatch">{{ busy ? 'DISPATCHING…' : 'DISPATCH' }}</button>
    <div v-if="msg" class="form-feedback-banner" :class="msg.level">{{ msg.text }}</div>

    <div class="form-title" style="margin-top:14px;">ACTIVE INCIDENTS · {{ incidents.length }}</div>
    <div v-for="inc in incidents" :key="inc.id" class="cyber-list-row" style="cursor:default;">
      <div class="row-flex-meta">
        <strong>{{ inc.type }}<span v-if="!inc.is_public"> · residential</span></strong>
        <button class="cyber-btn-dim" style="padding:2px 6px;" @click="$emit('stand-down', inc.id)">STAND DOWN</button>
      </div>
      <div class="row-flex-desc">
        {{ inc.lat.toFixed(4) }}, {{ inc.lng.toFixed(4) }}
        · {{ inc.responder_counts.responders }} resp · {{ inc.responder_counts.enroute }} en route · {{ inc.responder_counts.onscene }} on scene
      </div>
    </div>
    <div v-if="incidents.length === 0" class="cyber-empty-notice">No active incidents.</div>
  </div>
</template>

<style scoped>
.sub-wrapper { display:flex; flex-direction:column; gap:8px; }
.cyber-form-layout { display:flex; flex-direction:column; gap:8px; }
.form-title { font-size:11px; font-weight:700; color:#555; }
.field-wrap { display:flex; flex-direction:column; gap:3px; }
.field-wrap label { font-size:11px; color:#555; font-weight:600; }
.cyber-select, .cyber-field { background:#fff; border:1px solid #d0d0d0; padding:5px; color:#222; font-family:inherit; font-size:12px; border-radius:2px; }
.cyber-select:focus, .cyber-field:focus { outline:none; border-color:#999; }
.field-row-split { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.cyber-btn-bright { background:#555; color:#fff; border:none; padding:6px; font-weight:700; cursor:pointer; font-family:inherit; font-size:11px; border-radius:2px; }
.cyber-btn-bright:hover { background:#444; }
.cyber-btn-dim { background:#f5f5f5; color:#333; border:1px solid #d0d0d0; padding:5px; font-size:11px; cursor:pointer; font-family:inherit; border-radius:2px; }
.form-feedback-banner { font-size:12px; padding:5px; background:#fff; border:1px solid #d0d0d0; border-radius:2px; }
.form-feedback-banner.error { color:#222; }
.form-feedback-banner.warn { color:#555; }
.topology-checkbox-item { display:flex; align-items:center; gap:5px; font-size:11px; color:#555; cursor:pointer; }
.topology-checkbox-item input[type="checkbox"] { accent-color:#555; }
.cyber-list-row { padding:6px; border-bottom:1px solid #d0d0d0; cursor:pointer; background:#fff; }
.row-flex-meta { display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#222; }
.row-flex-desc { font-size:11px; color:#888; margin-top:2px; }
.cyber-empty-notice { padding:16px; text-align:center; color:#888; font-size:12px; }
</style>
