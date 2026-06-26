/**
 * Report Safe — Web Icon Set
 * ---------------------------------------------------------------------------
 * Inline, dependency-free SVG glyphs on a 24×24 grid, named to MATCH the
 * mobile app's Ionicons vocabulary (see mobile/src/theme.ts STATUS_ICON /
 * DISASTER_ICON). Stroke-based "operations" style: every glyph inherits the
 * current text color via `currentColor`, so a red `alert-circle` on web reads
 * as the same symbol/colour as the red filled alert-circle on mobile.
 *
 * Why inline (not a CDN web-font or npm package): Report Safe must work with
 * no connectivity. Bundled SVG paint instantly and offline; an icon font that
 * 404s during a disaster would silently blank every control.
 *
 * Each entry is the INNER markup of an <svg viewBox="0 0 24 24"> whose root
 * sets: fill="none" stroke="currentColor" stroke-width="2" round caps/joins.
 * Filled accents (dots, stars) opt in with their own fill/stroke attributes.
 */

export const ICONS = {
  /* ── Report status (mirrors mobile STATUS_ICON) ───────────────────── */
  // safe
  'checkmark-circle': '<circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.6 2.6L16 9.2"/>',
  // injured
  'medkit': '<rect x="3.5" y="7.5" width="17" height="12.5" rx="2.5"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M12 10.8v6M9 13.8h6"/>',
  // clinic — heart + vitals (mirrors mobile Ionicons 'fitness')
  'fitness': '<path d="M12 20.5C6.2 16.6 4 13.4 4 10.1A3.9 3.9 0 0 1 12 7.4 3.9 3.9 0 0 1 20 10.1c0 1-.2 1.9-.6 2.8"/><path d="M3.6 13.6h3.3l1.3-2.9 2.2 5 1.3-2.1H15.5"/>',
  // need_help
  'alert-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 7.6v5.2"/><circle cx="12" cy="16.4" r="1.05" fill="currentColor" stroke="none"/>',
  // awaiting_response
  'help-circle': '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.4a2.5 2.5 0 1 1 3.4 2.3c-.9.4-1.4 1-1.4 1.9v.3"/><circle cx="11.5" cy="16.4" r="1.05" fill="currentColor" stroke="none"/>',
  // potentially_missing
  'search': '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/>',
  // missing
  'person-remove': '<circle cx="9" cy="7.8" r="3.2"/><path d="M3.4 19.5a5.6 5.6 0 0 1 11.2 0"/><path d="M16.8 9.4h4.6"/>',
  // verified_missing
  'warning': '<path d="M12 4.2L21 19.2H3L12 4.2z"/><path d="M12 10v4"/><circle cx="12" cy="16.8" r="1.05" fill="currentColor" stroke="none"/>',
  // rescued
  'shield-checkmark': '<path d="M12 3l7 2.5v5.1c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V5.5L12 3z"/><path d="M8.7 12l2.3 2.3 4.4-4.8"/>',
  // deceased
  'remove-circle': '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  // fallback
  'ellipse': '<circle cx="12" cy="12" r="9"/>',

  /* ── Disaster types (mirrors mobile DISASTER_ICON) ────────────────── */
  // earthquake — EKG/seismograph trace
  'pulse': '<path d="M2.5 13H6l2-6 3.2 12L14.5 8l1.8 5h5"/>',
  // typhoon / storm — cloud + bolt
  'thunderstorm': '<path d="M7.5 16.5a4 4 0 0 1-.6-8 5 5 0 0 1 9.7 1.3 3.5 3.5 0 0 1 .4 6.7"/><path d="M12.5 12.5l-2.2 3.5h3l-2 3.5"/>',
  // flood / tsunami — water droplet
  'water': '<path d="M12 3.5c4 5 6.2 7.6 6.2 10.7a6.2 6.2 0 0 1-12.4 0C5.8 11.1 8 8.5 12 3.5z"/>',
  // fire — flame
  'flame': '<path d="M12 3c3.2 3.8 5 6.1 5 9a5 5 0 0 1-10 0c0-1.3.4-2.4 1.1-3.4.3 1.1.9 1.8 1.8 2C10.2 8.7 10.8 6.2 12 3z"/>',

  /* ── Navigation / chrome ──────────────────────────────────────────── */
  'home': '<path d="M3.5 11.5L12 4l8.5 7.5"/><path d="M5.5 10.2V20h13V10.2"/>',
  'megaphone': '<path d="M4 10v4h2.5l9 4.5V5.5L6.5 10H4z"/><path d="M18 9.5a4 4 0 0 1 0 5"/>',
  'people': '<circle cx="9" cy="8" r="3"/><path d="M3 19.5a6 6 0 0 1 12 0"/><circle cx="17.2" cy="8.6" r="2.3"/><path d="M15.6 13.4c2.7.1 4.8 1.9 5.4 5"/>',
  'heart': '<path d="M12 20s-7-4.6-9.2-9.1C1.3 7.7 3 5 6 5c2 0 3.2 1.2 4 2.4C10.8 6.2 12 5 14 5c3 0 4.7 2.7 3.2 5.9C19 15.4 12 20 12 20z"/>',
  'mail-unread': '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h9a1.5 1.5 0 0 1 1.5 1.5V16a2 2 0 0 1-2 2H5a2 2 0 0 1-1-3.7"/><path d="M4 8l6 4 3.2-2.1"/><circle cx="19" cy="6" r="2.6"/>',
  'person': '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
  // Gender symbols (Mars / Venus) — used for user-profile avatars.
  'male':   '<circle cx="10" cy="14" r="5"/><path d="M14 10l6-6M15 4h5v5"/>',
  'female': '<circle cx="12" cy="9" r="5"/><path d="M12 14v7M9 18h6"/>',
  'person-add': '<circle cx="9" cy="8" r="3.1"/><path d="M3.4 19.5a5.6 5.6 0 0 1 11.2 0"/><path d="M18.5 7v6M15.5 10h6"/>',
  'person-circle': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="2.6"/><path d="M6.8 18.4a5.4 5.4 0 0 1 10.4 0"/>',
  'navigate': '<path d="M20.5 3.5L3.5 10.8l7 2.6 2.4 6.9L20.5 3.5z"/>',
  'location': '<path d="M12 21s7-6.4 7-11a7 7 0 0 0-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  'map': '<path d="M3 7l6-2 6 2 6-2v14l-6 2-6-2-6 2V7z"/><path d="M9 5v14M15 7v14"/>',
  'layers': '<path d="M12 4l8.5 4-8.5 4-8.5-4L12 4z"/><path d="M3.7 12L12 16l8.3-4"/><path d="M3.7 16L12 20l8.3-4"/>',
  'funnel': '<path d="M4 5.5h16l-6.2 7.2v5.3l-3.6 1.8v-7.1L4 5.5z"/>',
  'list': '<path d="M8.5 6.5h11.5M8.5 12h11.5M8.5 17.5h11.5"/><circle cx="4.5" cy="6.5" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="17.5" r="1" fill="currentColor" stroke="none"/>',
  'stats-chart': '<path d="M4 20V11M9.3 20V5M14.7 20v-6M20 20V8"/><path d="M3 20.5h18"/>',
  'grid': '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',

  /* ── Actions / controls ───────────────────────────────────────────── */
  'star': '<path d="M12 3.2l2.6 5.6 6.1.8-4.5 4.2 1.1 6-5.3-2.8-5.3 2.8 1.1-6L3.3 9.6l6.1-.8L12 3.2z" fill="currentColor"/>',
  'star-outline': '<path d="M12 3.8l2.5 5.3 5.8.8-4.2 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.2-4 5.8-.8L12 3.8z"/>',
  'refresh': '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
  'create': '<path d="M14.5 5.5l4 4L9 19l-4.5 1 1-4.5L14.5 5.5z"/><path d="M13.5 6.5l4 4"/>',
  'pencil': '<path d="M14.5 5.5l4 4L9 19l-4.5 1 1-4.5L14.5 5.5z"/><path d="M13.5 6.5l4 4"/>',
  'close': '<path d="M6 6l12 12M18 6L6 18"/>',
  'add': '<path d="M12 5v14M5 12h14"/>',
  'add-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8.2v7.6M8.2 12h7.6"/>',
  'arrow-forward': '<path d="M4.5 12h15M13 5.5l6.5 6.5-6.5 6.5"/>',
  'chevron-forward': '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  'chevron-down': '<path d="M5.5 9l6.5 6.5L18.5 9"/>',
  'checkmark': '<path d="M5 13l4.5 4.5L19.5 7"/>',
  'log-out': '<path d="M9 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H9"/><path d="M16 16l4-4-4-4"/><path d="M20 12H9.5"/>',
  'send': '<path d="M20.5 3.5L3.5 10.8l7 2.6 2.4 6.9L20.5 3.5z"/><path d="M10.5 13.4l4-4"/>',

  /* ── Privacy / visibility / connectivity ──────────────────────────── */
  'lock-closed': '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.2" r="1.05" fill="currentColor" stroke="none"/>',
  'lock-open': '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-1.9"/>',
  'globe': '<circle cx="12" cy="12" r="9"/><path d="M3.5 9.5h17M3.5 14.5h17"/><path d="M12 3c2.8 2.6 2.8 15.4 0 18M12 3c-2.8 2.6-2.8 15.4 0 18"/>',
  'globe-outline': '<circle cx="12" cy="12" r="9"/><path d="M3.5 9.5h17M3.5 14.5h17"/><path d="M12 3c2.8 2.6 2.8 15.4 0 18M12 3c-2.8 2.6-2.8 15.4 0 18"/>',
  'eye': '<path d="M2.5 12s3.8-6.8 9.5-6.8S21.5 12 21.5 12s-3.8 6.8-9.5 6.8S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  'eye-off': '<path d="M4.5 5L19.5 19"/><path d="M9.3 5.6A9.6 9.6 0 0 1 12 5.2c5.7 0 9.5 6.8 9.5 6.8a16 16 0 0 1-2.6 3.3"/><path d="M6 7.4A16 16 0 0 0 2.5 12s3.8 6.8 9.5 6.8a9.3 9.3 0 0 0 3.2-.55"/><path d="M9.8 9.9a3 3 0 0 0 4.2 4.2"/>',
  'cloud-offline': '<path d="M7.5 18.5A4.2 4.2 0 0 1 7 10.1a5.3 5.3 0 0 1 8.7-2.4"/><path d="M16.5 9.6A3.6 3.6 0 0 1 17.5 16.5"/><path d="M4 4l16 16"/>',
  'cloud-done': '<path d="M7 18.5A4.4 4.4 0 0 1 6.6 9.8a5.5 5.5 0 0 1 10.6 1.4A3.7 3.7 0 0 1 17 18.5H7z"/><path d="M9.5 13.8l1.8 1.8 3.4-3.6"/>',
  'cloud': '<path d="M7 18.5A4.4 4.4 0 0 1 6.6 9.8a5.5 5.5 0 0 1 10.6 1.4A3.7 3.7 0 0 1 17 18.5H7z"/>',
  'shield': '<path d="M12 3l7 2.5v5.1c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V5.5L12 3z"/>',
  'information-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5"/><circle cx="12" cy="8" r="1.05" fill="currentColor" stroke="none"/>',
  'radio-on': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>',
  'radio-off': '<circle cx="12" cy="12" r="9"/>',

  /* ── Facilities / misc (shelters, contact) ────────────────────────── */
  'business': '<path d="M4 20.5V8l8-3.5L20 8v12.5"/><path d="M3 20.5h18"/><path d="M10 20.5v-4h4v4"/><path d="M8 10.5h.01M12 10.5h.01M16 10.5h.01M8 14h.01M16 14h.01"/>',
  'flag': '<path d="M6 21V4"/><path d="M6 5h11l-2.3 3.3L17 11.5H6"/>',
  'time': '<circle cx="12" cy="12" r="9"/><path d="M12 7.2v5.2l3.4 2"/>',
  'call': '<path d="M5 4.5h3.2l1.5 4-2.1 1.6a11.5 11.5 0 0 0 5 5l1.6-2.1 4 1.5v3.1a2 2 0 0 1-2.1 2A15.4 15.4 0 0 1 3 6.6a2 2 0 0 1 2-2.1z"/>',
  'walk': '<circle cx="13" cy="4.6" r="1.8"/><path d="M11.5 21l1.2-5.5-2.2-2 1-4.2 3 1.3 1 3"/><path d="M10.5 9.3L7.5 11"/><path d="M12.7 15.5L9.5 21"/>',
  'megaphone-outline': '<path d="M4 10v4h2.5l9 4.5V5.5L6.5 10H4z"/><path d="M18 9.5a4 4 0 0 1 0 5"/>',
  'pin': '<path d="M12 21s7-6.4 7-11a7 7 0 0 0-14 0c0 4.6 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  'resize': '<path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"/>',
  'wifi': '<path d="M5 12.5a10 10 0 0 1 14 0M7.5 15.5a6 6 0 0 1 9 0"/><circle cx="12" cy="18.5" r="1.1" fill="currentColor" stroke="none"/>',
};
