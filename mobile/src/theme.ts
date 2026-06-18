/**
 * Report Safe — Mobile Design Tokens v3
 * Government EOC — Light Theme
 * Aligned with web design system v4 (Inter, white panels, gov blue)
 */

export const C = {
  /* Canvas layers */
  bgCanvas: '#F8FAFC',
  bgPanel:  '#FFFFFF',
  bgRaised: '#F1F5F9',
  bgHover:  '#E2E8F0',

  /* Text */
  textHi:  '#0F172A',
  textMd:  '#334155',
  textLo:  '#64748B',
  textInv: '#FFFFFF',

  /* Borders */
  border:       '#E2E8F0',
  borderStrong: '#CBD5E1',

  /* Brand / Government blue */
  brand:      '#1E3A5F',
  govBlue:    '#2563EB',
  govBlueDim: '#EFF6FF',

  /* Action amber — warm primary CTA (submit / search).
     Deepened to #B45309 so white text on the amber button clears WCAG AA. */
  amber:       '#B45309',
  amberDim:    '#FFFBEB',
  amberBorder: '#FDE68A',

  /* Status colours deepened one notch so small text clears WCAG AA on the
     pale *-dim tints (was ~3:1); same hues, matches web main.css tokens. */

  /* Status: Safe — green */
  safe:        '#15803D',
  safeDim:     '#F0FDF4',
  safeBorder:  '#BBF7D0',

  /* Status: Injured — amber */
  injured:        '#A16207',
  injuredDim:     '#FEFCE8',
  injuredBorder:  '#FDE68A',

  /* Status: Need Help / Critical — red */
  critical:        '#DC2626',
  criticalDim:     '#FEF2F2',
  criticalBorder:  '#FECACA',

  /* Status: Awaiting Response — orange */
  awaiting:        '#C2410C',
  awaitingDim:     '#FFF7ED',
  awaitingBorder:  '#FED7AA',

  /* Status: Potentially Missing — rose */
  potMissing:        '#9F1239',
  potMissingDim:     '#FFF1F2',
  potMissingBorder:  '#FECDD3',

  /* Status: Missing / Unknown — slate */
  missing:        '#475569',
  missingDim:     '#F8FAFC',
  missingBorder:  '#CBD5E1',

  /* Status: Rescued — cyan */
  rescued:        '#0E7490',
  rescuedDim:     '#F0F9FF',
  rescuedBorder:  '#BAE6FD',

  /* Status: Deceased — dark gray */
  deceased:        '#374151',
  deceasedDim:     '#F9FAFB',
  deceasedBorder:  '#D1D5DB',

  /* Disaster */
  disaster:        '#DC2626',
  disasterDim:     '#FEF2F2',
  disasterBorder:  '#FECACA',

  /* Elevation */
  shadowSm: 'rgba(0,0,0,0.10)',
} as const;

/** Corner radius scale (8-pt aligned). */
export const R = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  pill: 999,
} as const;

/** Soft elevation presets — tinted, never harsh. Spread into a style. */
export const SHADOW = {
  card: {
    shadowColor:   '#0F172A',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius:  8,
    elevation:     2,
  },
  raised: {
    shadowColor:   '#0F172A',
    shadowOffset:  { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius:  16,
    elevation:     5,
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
    color: C.govBlue, dim: C.govBlueDim, border: '#BFDBFE', // = web --gov-blue-border
  },
};
