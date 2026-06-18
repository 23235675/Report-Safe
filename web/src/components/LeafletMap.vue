<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ICONS } from './icons.js';
import { STATUS_ICON, SHELTER_ICON } from '../iconography.js';

const props = defineProps({
  reports:  { type: Array,  default: () => [] },
  disaster: { type: Object, default: null },
  shelters: { type: Array,  default: () => [] },
  layers:   { type: Object, default: null },
});
const emit = defineEmits(['markerClick']);

const mapEl = ref(null);

let map            = null;
let reportLayer    = null;
let shelterLayer   = null;
let disasterCircle = null;

// Design system v4 — light map, high-contrast markers.
// Hexes mirror the --status tokens in main.css / theme.ts (Leaflet divIcon HTML
// can't use var()); keep these in sync if the tokens change.
const STATUS_COLORS = {
  safe:                '#15803D',
  injured:             '#A16207',
  need_help:           '#DC2626',
  awaiting_response:   '#C2410C',
  potentially_missing: '#9F1239',
  verified_missing:    '#9F1239',
  missing:             '#475569',
  rescued:             '#0E7490',
  deceased:            '#374151',
};

const SHELTER_COLOR = '#2563EB';

/** Inline an AppIcon-vocabulary glyph as raw SVG markup for a Leaflet divIcon. */
function glyph(name, color, size) {
  const inner = ICONS[name] || ICONS.ellipse;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

function reportIcon(status, priority) {
  const color = STATUS_COLORS[status] || '#475569';
  // Critical (P1) reports render as a real alert medallion — the same red
  // alert icon the report shows as on mobile and in the triage list.
  if (priority === 0) {
    return L.divIcon({
      className: '',
      html: `<span class="rs-marker" style="width:26px;height:26px;background:${color};
              border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 4px ${color}33;">
              ${glyph(STATUS_ICON[status] || 'alert-circle', '#fff', 16)}</span>`,
      iconSize:   [26, 26],
      iconAnchor: [13, 13],
    });
  }
  const size = priority === 1 ? 15 : 12;
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:${size}px;height:${size}px;
            background:${color};border:2px solid #fff;border-radius:50%;"></span>`,
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
    marker.on('click', () => emit('markerClick', r.id));
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
    marker.addTo(shelterLayer);
  }

  if (disasterCircle) { map.removeLayer(disasterCircle); disasterCircle = null; }
  if (props.disaster) {
    disasterCircle = L.circle(
      [props.disaster.lat, props.disaster.lng],
      {
        radius:      props.disaster.radius_km * 1000,
        color:       '#DC2626',
        fillColor:   '#DC2626',
        fillOpacity: 0.05,
        weight:      2,
        dashArray:   '6 4',
      }
    ).addTo(map);
  }

  fitToContent();
}

function fitToContent() {
  if (!map) return;
  const pts = [
    ...props.reports.filter((r) => typeof r.lat === 'number').map((r) => [r.lat, r.lng]),
    ...props.shelters.filter((s) => typeof s.lat === 'number').map((s) => [s.lat, s.lng]),
  ];
  if (props.disaster) pts.push([props.disaster.lat, props.disaster.lng]);
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

  reportLayer  = L.layerGroup().addTo(map);
  shelterLayer = L.layerGroup().addTo(map);

  renderAll();
  nextTick(() => map && map.invalidateSize());
});

watch(() => [props.reports, props.shelters, props.disaster], renderAll, { deep: true });

onUnmounted(() => {
  if (map) { map.remove(); map = null; }
});
</script>

<template>
  <div ref="mapEl" class="leaflet-map"></div>
</template>
