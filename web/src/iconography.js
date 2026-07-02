/**
 * Report Safe — Web Iconography & Status Vocabulary
 * ---------------------------------------------------------------------------
 * The web mirror of mobile/src/theme.ts. ONE source of truth so a status,
 * disaster, or facility resolves to the same icon + label + colour on every
 * web screen — and to the same symbol/colour the mobile app already uses.
 */

/* Report status → icon name (identical mapping to mobile STATUS_ICON). */
export const STATUS_ICON = {
  safe:                'checkmark-circle',
  injured:             'medkit',
  need_help:           'alert-circle',
  awaiting_response:   'help-circle',
  potentially_missing: 'search',
  missing:             'person-remove',
  verified_missing:    'warning',
  rescued:             'shield-checkmark',
  deceased:            'remove-circle',
};

/* Full labels (identical to mobile STATUS_LABEL). */
export const STATUS_LABEL = {
  safe:                'Safe',
  injured:             'Injured',
  need_help:           'Need Help',
  awaiting_response:   'Awaiting Response',
  potentially_missing: 'Pot. Missing',
  missing:             'Missing',
  verified_missing:    'Verified Missing',
  rescued:             'Rescued',
  deceased:            'Deceased',
};

/* Compact labels for dense rows / command bars. */
export const STATUS_SHORT = {
  safe:                'Safe',
  injured:             'Injured',
  need_help:           'Need Help',
  awaiting_response:   'Awaiting',
  potentially_missing: 'Pot. Missing',
  missing:             'Missing',
  verified_missing:    'Verified Missing',
  rescued:             'Rescued',
  deceased:            'Deceased',
};

/* Status → CSS colour token (same hexes as mobile theme.ts). */
export const STATUS_COLOR = {
  safe:                'var(--safe)',
  injured:             'var(--injured)',
  need_help:           'var(--need-help)',
  awaiting_response:   'var(--awaiting)',
  potentially_missing: 'var(--pot-missing)',
  missing:             'var(--missing)',
  verified_missing:    'var(--need-help)',
  rescued:             'var(--rescued)',
  deceased:            'var(--deceased)',
};

/* Status → dim background token (for icon tiles / chips). */
export const STATUS_DIM = {
  safe:                'var(--safe-dim)',
  injured:             'var(--injured-dim)',
  need_help:           'var(--need-help-dim)',
  awaiting_response:   'var(--awaiting-dim)',
  potentially_missing: 'var(--pot-missing-dim)',
  missing:             'var(--missing-dim)',
  verified_missing:    'var(--need-help-dim)',
  rescued:             'var(--rescued-dim)',
  deceased:            'var(--deceased-dim)',
};

/* Status → vivid colour (Gov EOC dashboard only — the rest of the app uses
 * the monochrome STATUS_COLOR/STATUS_DIM tokens above). Aligned to the Admin
 * console's status palette (AdminView.vue .st-* classes) so both privileged
 * dashboards read the same way. Opt in via the `vivid` prop on
 * StatusIcon/StatusBadge. */
// Safe = green, Rescued = blue. Every other status is red, graduated by
// importance: the more important the status, the darker the red.
// missing > need_help > injured > potentially_missing > awaiting_response > deceased
export const STATUS_COLOR_VIVID = {
  safe:                '#1a7a3f', // green
  rescued:             '#1a7abf', // blue
  missing:             '#5c0d0d', // darkest red — most important
  verified_missing:    '#5c0d0d',
  need_help:           '#7d1818',
  injured:             '#9c2424',
  potentially_missing: '#b53636',
  awaiting_response:   '#c75050',
  deceased:            '#cf6a6a', // lightest red — least important
};

/* Status → existing badge class in main.css. */
export const STATUS_BADGE_CLASS = {
  safe:                'badge-safe',
  injured:             'badge-injured',
  need_help:           'badge-need-help',
  awaiting_response:   'badge-awaiting',
  potentially_missing: 'badge-pot-missing',
  missing:             'badge-missing',
  verified_missing:    'badge-pot-missing',
  rescued:             'badge-rescued',
  deceased:            'badge-deceased',
};

/* Disaster type → icon name (identical to mobile DISASTER_ICON). */
export const DISASTER_ICON = {
  earthquake: 'pulse',
  typhoon:    'thunderstorm',
  flood:      'water',
  fire:       'flame',
  tsunami:    'water',
};

/* Facility type → icon name (matches mobile MapScreen TYPE_COLORS icons). */
export const SHELTER_ICON = {
  hospital: 'medkit',
  clinic:   'fitness',
  shelter:  'home',
  assembly: 'flag',
};

/* User gender → avatar icon (Mars/Venus). Falls back to a neutral person. */
export function genderIcon(g) {
  const k = String(g ?? '').toLowerCase();
  return k === 'male' ? 'male' : k === 'female' ? 'female' : 'person';
}

export function statusIcon(s)  { return STATUS_ICON[s]  || 'ellipse'; }
export function statusColor(s) { return STATUS_COLOR[s] || 'var(--missing)'; }
export function statusDim(s)   { return STATUS_DIM[s]   || 'var(--bg-raised)'; }
export function statusLabel(s) { return STATUS_LABEL[s] || (s || '').replace(/_/g, ' '); }
export function shelterIcon(t) { return SHELTER_ICON[t] || 'business'; }

/**
 * The backend sends `severity` as EITHER a 1–5 number (3, 5) OR a string label
 * ("moderate", "high"). Normalise to one ordered scale so labels, colours, and
 * any sort agree — otherwise a string severity fails every numeric comparison
 * (`"high" < 3` is NaN) and silently buckets as the highest tier.
 */
export function severityRank(s) {
  if (typeof s === 'number' && Number.isFinite(s)) return s;
  switch (String(s ?? '').toLowerCase()) {
    case 'low':
    case 'minor':    return 2;
    case 'medium':
    case 'moderate': return 3;
    case 'high':
    case 'severe':   return 4;
    case 'extreme':
    case 'critical': return 5;
    default:         return 0;
  }
}

/* Disaster severity → { label, icon, colorVar, dimVar } (matches mobile). */
export function severityInfo(s) {
  const r = severityRank(s);
  if (r < 3) return { label: 'Minor',    cls: 'sev-minor',    colorVar: 'var(--safe)',     dimVar: 'var(--safe-dim)' };
  if (r < 4) return { label: 'Moderate', cls: 'sev-moderate', colorVar: 'var(--injured)',  dimVar: 'var(--injured-dim)' };
  if (r < 5) return { label: 'Severe',   cls: 'sev-severe',   colorVar: 'var(--awaiting)', dimVar: 'var(--awaiting-dim)' };
  return       { label: 'Extreme',  cls: 'sev-extreme',  colorVar: 'var(--need-help)', dimVar: 'var(--need-help-dim)' };
}

/**
 * Privacy-tier visibility descriptors — the system's four data-exposure states,
 * made legible with one consistent icon + colour on both surfaces.
 *
 *   pending  — written to the on-device outbox, not yet delivered (amber)
 *   synced   — delivered to the server / family (green)
 *   coarse   — public & family see ~1 km location only (slate)
 *   rescue   — exact GPS, visible to authorised rescue teams only (gov blue)
 */
export const VISIBILITY = {
  pending: {
    key: 'pending', icon: 'cloud-offline', label: 'Pending sync', short: 'Pending',
    detail: 'Held on this device — will deliver when a connection returns.',
    colorVar: 'var(--awaiting)', dimVar: 'var(--awaiting-dim)', borderVar: 'var(--awaiting-border)',
  },
  synced: {
    key: 'synced', icon: 'cloud-done', label: 'Synced', short: 'Synced',
    detail: 'Delivered to the server and shared with family.',
    colorVar: 'var(--safe)', dimVar: 'var(--safe-dim)', borderVar: 'var(--safe-border)',
  },
  coarse: {
    key: 'coarse', icon: 'globe-outline', label: 'Public · ~1 km', short: 'Public ~1 km',
    detail: 'Public & family see an approximate location only (±1 km). Medical notes hidden.',
    colorVar: '#4b5563', dimVar: '#f3f4f6', borderVar: '#d1d5db',
  },
  rescue: {
    key: 'rescue', icon: 'lock-closed', label: 'Rescue-only · exact GPS', short: 'Rescue-only',
    detail: 'Exact GPS and medical notes are visible to authorised rescue teams only.',
    colorVar: '#374151', dimVar: '#e5e7eb', borderVar: '#9ca3af',
  },
};
