/**
 * Report Safe — Mobile Design Tokens "Pine"
 * Aligned 1:1 with the citizen web app palette (web/src/assets/main.css :root):
 * Pine-Green brand/authority (#0F766E) + the shared status hues, so mobile and
 * web read as one product. Squared corners, flat surfaces, crisp borders,
 * daylight-readable. Same token keys as before, so every screen re-skins with no
 * behaviour change. Fonts stay the system default.
 */

export const C = {
  /* Canvas layers — cool "ink" neutrals with a faint indigo undertone (web) */
  bgCanvas: '#F7F8FB',
  bgPanel:  '#FFFFFF',
  bgRaised: '#EFF1F6',
  bgHover:  '#E4E7F0',

  /* Text */
  textHi:  '#15182B',
  textMd:  '#353A52',
  textLo:  '#646A80',
  textInv: '#FFFFFF',

  /* Borders */
  border:       '#E2E5EE',
  borderStrong: '#CBD0DE',

  /* Authority — Pine Green (web --brand / --gov-blue). The single accent hue;
     token name kept as govBlue for back-compat. White text clears AA on fills. */
  brand:      '#022C2A',
  govBlue:    '#0F766E',
  govBlueDim: '#F2F8F7',

  /* Action — slate secondary CTA (web --amber, kept neutral so green stays the
     one accent). */
  amber:       '#334155',
  amberDim:    '#F1F5F9',
  amberBorder: '#CBD5E1',

  /* Status hues — mirror web :root exactly (citizen UI ↔ admin parity). */

  /* Status: Safe — green */
  safe:        '#1a7a3f',
  safeDim:     '#e8f9ee',
  safeBorder:  '#a7e0bd',

  /* Status: Injured — amber/brown */
  injured:        '#9a5f00',
  injuredDim:     '#fff4e0',
  injuredBorder:  '#f0d49a',

  /* Status: Need Help / Critical — red */
  critical:        '#c0392b',
  criticalDim:     '#fde8e8',
  criticalBorder:  '#f3b0b0',

  /* Status: Awaiting Response — amber */
  awaiting:        '#9a5f00',
  awaitingDim:     '#fff4e0',
  awaitingBorder:  '#f0d49a',

  /* Status: Potentially Missing — amber */
  potMissing:        '#9a5f00',
  potMissingDim:     '#fff4e0',
  potMissingBorder:  '#f0d49a',

  /* Status: Missing / Unknown — red */
  missing:        '#c0392b',
  missingDim:     '#fde8e8',
  missingBorder:  '#f3b0b0',

  /* Status: Rescued — blue */
  rescued:        '#1a7abf',
  rescuedDim:     '#e8f4fd',
  rescuedBorder:  '#b3dcf3',

  /* Status: Deceased — gray */
  deceased:        '#555555',
  deceasedDim:     '#f0f0f0',
  deceasedBorder:  '#d0d0d0',

  /* Disaster — near-black navy (web --disaster) */
  disaster:        '#0F172A',
  disasterDim:     '#F1F5F9',
  disasterBorder:  '#CBD5E1',

  /* Elevation */
  shadowSm: 'rgba(2,44,42,0.12)',
} as const;

/** Corner radius scale — squared/official. Chips stay pill (`pill`). */
export const R = {
  sm:   4,
  md:   6,
  lg:   8,
  xl:   10,
  pill: 999,
} as const;

/** Flat-ish elevation presets — navy-tinted, government-restrained. */
export const SHADOW = {
  card: {
    shadowColor:   '#022C2A',
    shadowOffset:  { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius:  3,
    elevation:     1,
  },
  raised: {
    shadowColor:   '#022C2A',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius:  10,
    elevation:     4,
  },
} as const;

/** Map a report status string to its primary color token. */
export function statusColor(status: string): string {
  switch (status) {
    case 'safe':                return C.safe;
    case 'injured':             return C.injured;
    case 'need_help':           return C.critical;
    case 'awaiting_response':   return C.awaiting;
    case 'potentially_missing': return C.potMissing;
    case 'missing':             return C.missing;
    case 'verified_missing':    return C.potMissing;
    case 'rescued':             return C.rescued;
    case 'deceased':            return C.deceased;
    default:                    return C.textLo;
  }
}

/** Map a report status string to its background dim color. */
export function statusDim(status: string): string {
  switch (status) {
    case 'safe':                return C.safeDim;
    case 'injured':             return C.injuredDim;
    case 'need_help':           return C.criticalDim;
    case 'awaiting_response':   return C.awaitingDim;
    case 'potentially_missing': return C.potMissingDim;
    case 'missing':             return C.missingDim;
    case 'verified_missing':    return C.potMissingDim;
    case 'rescued':             return C.rescuedDim;
    case 'deceased':            return C.deceasedDim;
    default:                    return C.bgRaised;
  }
}

/** Map a report status string to its border color. */
export function statusBorder(status: string): string {
  switch (status) {
    case 'safe':                return C.safeBorder;
    case 'injured':             return C.injuredBorder;
    case 'need_help':           return C.criticalBorder;
    case 'awaiting_response':   return C.awaitingBorder;
    case 'potentially_missing': return C.potMissingBorder;
    case 'missing':             return C.missingBorder;
    case 'verified_missing':    return C.potMissingBorder;
    case 'rescued':             return C.rescuedBorder;
    case 'deceased':            return C.deceasedBorder;
    default:                    return C.border;
  }
}

/** Ionicons glyph name for each report status — instantly recognizable. */
export const STATUS_ICON: Record<string, string> = {
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

/** Ionicons glyph name for each disaster type. */
export const DISASTER_ICON: Record<string, string> = {
  earthquake: 'pulse',
  typhoon:    'thunderstorm',
  flood:      'water',
  fire:       'flame',
  tsunami:    'water',
};

export const STATUS_LABEL: Record<string, string> = {
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

/**
 * Privacy-tier visibility descriptors — the system's four data-exposure states,
 * made legible with one consistent Ionicon + colour. Mirrors the web
 * iconography.js VISIBILITY so both surfaces speak the same privacy language.
 *   pending — on-device outbox, not yet delivered (amber)
 *   synced  — delivered to server / family (green)
 *   coarse  — public & family see ~1 km only (slate)
 *   rescue  — exact GPS, rescue teams only (gov blue)
 */
export type VisibilityTier = 'pending' | 'synced' | 'coarse' | 'rescue';

export const VISIBILITY: Record<VisibilityTier, {
  icon: string; label: string; short: string; detail: string;
  color: string; dim: string; border: string;
}> = {
  pending: {
    icon: 'cloud-offline', label: 'Pending sync', short: 'Pending',
    detail: 'Held on this device — will deliver when a connection returns.',
    color: C.awaiting, dim: C.awaitingDim, border: C.awaitingBorder,
  },
  synced: {
    icon: 'cloud-done', label: 'Synced', short: 'Synced',
    detail: 'Delivered to the server and shared with family.',
    color: C.safe, dim: C.safeDim, border: C.safeBorder,
  },
  coarse: {
    icon: 'globe-outline', label: 'Public · ~1 km', short: 'Public ~1 km',
    detail: 'Public & family see an approximate location only (±1 km). Medical notes hidden.',
    color: C.missing, dim: C.missingDim, border: C.missingBorder,
  },
  rescue: {
    icon: 'lock-closed', label: 'Rescue-only · exact GPS', short: 'Rescue-only',
    detail: 'Exact GPS and medical notes are visible to authorised rescue teams only.',
    color: C.govBlue, dim: C.govBlueDim, border: '#99CBC8', // pine-tint border (web --gov-blue-border)
  },
};
