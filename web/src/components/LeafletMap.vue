<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ICONS } from './icons.js';
import { SHELTER_ICON, STATUS_COLOR_VIVID } from '../iconography.js';

const props = defineProps({
  reports:   { type: Array, default: () => [] },
  disasters: { type: Array, default: () => [] },
  shelters:  { type: Array, default: () => [] },
  layers:    { type: Object, default: null },
});
const emit = defineEmits(['markerClick', 'move']);

const mapEl = ref(null);

let map           = null;
let reportLayer   = null;
let shelterLayer  = null;
let disasterLayer = null;

// Gov EOC map palette — one source of truth shared with the Admin console and
// the Gov dashboard (iconography.js STATUS_COLOR_VIVID): safe green, rescued
// blue, every other status a red graduated by importance.
const STATUS_COLORS = STATUS_COLOR_VIVID;

const SHELTER_COLOR = '#1B3A6B';

/** Inline an AppIcon-vocabulary glyph as raw SVG markup for a Leaflet divIcon. */
function glyph(name, color, size) {
  const inner = ICONS[name] || ICONS.ellipse;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

// Every report marker is a person glyph (no per-status icon shape, no gender
// data on the report) — colour and ring size carry the urgency instead.
function reportIcon(status, priority) {
  const color = STATUS_COLORS[status] || '#475569';
  const size  = priority === 0 ? 26 : priority === 1 ? 20 : 16;
  const ring  = priority === 0 ? `box-shadow:0 0 0 4px ${color}33;` : '';
  return L.divIcon({
    className: '',
    html: `<span class="rs-marker" style="width:${size}px;height:${size}px;background:${color};
            border:2px solid #fff;border-radius:50%;${ring}">
            ${glyph('person', '#fff', Math.round(size * 0.62))}</span>`,
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function shelterIcon(type) {
  const name = SHELTER_ICON[type] || 'business';
  return L.divIcon({
    className: '',
    html: `<span class="rs-marker" style="width:22px;height:22px;background:${SHELTER_COLOR};
            border-radius:5px;border:2px solid #fff;">${glyph(name, '#fff', 14)}</span>`,
    iconSize:   [22, 22],
    iconAnchor: [11, 11],
  });
}

function renderAll() {
  if (!map || !reportLayer || !shelterLayer) return;

  reportLayer.clearLayers();
  for (const r of props.reports) {
    if (typeof r.lat !== 'number' || typeof r.lng !== 'number') continue;
    const marker = L.marker([r.lat, r.lng], { icon: reportIcon(r.status, r.priority ?? 3) });
    const statusLabel = (r.status || '').replace(/_/g, ' ').toUpperCase();
    marker.bindTooltip(
      `<strong>${r.name}</strong><br>${statusLabel}` +
      (r.distance_km != null ? `<br>${r.distance_km.toFixed(1)} km` : '') +
      (r.reporter_name ? `<br><em>via ${r.reporter_name}</em>` : ''),
      { sticky: true }
    );
    marker.on('click', () => { emit('markerClick', r.id); map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 14)); });
    marker.addTo(reportLayer);
  }

  shelterLayer.clearLayers();
  for (const s of props.shelters) {
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    const marker = L.marker([s.lat, s.lng], { icon: shelterIcon(s.type) });
    marker.bindTooltip(
      `<strong>${s.name}</strong><br><em>${s.type}</em>` +
      (s.capacity ? `<br>Capacity: ${s.capacity}` : '') +
      (s.phone    ? `<br>${s.phone}`               : ''),
      { sticky: true }
    );
    marker.on('click', () => map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 14)));
    marker.addTo(shelterLayer);
  }

  disasterLayer.clearLayers();
  for (const d of props.disasters) {
    if (typeof d.lat !== 'number' || typeof d.lng !== 'number') continue;
    const circle = L.circle([d.lat, d.lng], {
      radius:      (d.radius_km || 1) * 1000,
      color:       '#16335A',
      fillColor:   '#16335A',
      fillOpacity: 0.05,
      weight:      2,
      dashArray:   '6 4',
    });
    circle.bindTooltip(`<strong>${d.type}</strong><br>${d.radius_km} km radius`, { sticky: true });
    circle.on('click', () => map.fitBounds(circle.getBounds().pad(0.2)));
    circle.addTo(disasterLayer);
  }

  fitToContent();
}

function fitToContent() {
  if (!map) return;
  const pts = [
    ...props.reports.filter((r) => typeof r.lat === 'number').map((r) => [r.lat, r.lng]),
    ...props.shelters.filter((s) => typeof s.lat === 'number').map((s) => [s.lat, s.lng]),
    ...props.disasters.filter((d) => typeof d.lat === 'number').map((d) => [d.lat, d.lng]),
  ];
  if (pts.length > 0) {
    try { map.fitBounds(L.latLngBounds(pts).pad(0.2)); } catch {}
  }
}

onMounted(() => {
  if (!mapEl.value) return;
  map = L.map(mapEl.value, { center: [22.3, 114.1], zoom: 6, zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  reportLayer   = L.layerGroup().addTo(map);
  shelterLayer  = L.layerGroup().addTo(map);
  disasterLayer = L.layerGroup().addTo(map);

  // Surface the live map centre so callers can show real, updating coordinates.
  map.on('moveend', () => {
    const c = map.getCenter();
    emit('move', { lat: c.lat, lng: c.lng });
  });

  renderAll();
  nextTick(() => map && map.invalidateSize());
});

watch(() => [props.reports, props.shelters, props.disasters], renderAll, { deep: true });

onUnmounted(() => {
  if (map) { map.remove(); map = null; }
});

// Callable from the parent — e.g. clicking a person/facility in a side list
// pans the map to it, same as clicking the marker itself.
function flyTo(lat, lng) {
  if (map && typeof lat === 'number' && typeof lng === 'number') {
    map.flyTo([lat, lng], Math.max(map.getZoom(), 14));
  }
}
defineExpose({ flyTo });
</script>

<template>
  <div ref="mapEl" class="leaflet-map"></div>
</template>
