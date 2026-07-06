/**
 * Pure SVG radar-chart math for the Gov console risk radar (no charting lib).
 * Every function is pure and returns strings formatted exactly as the SVG
 * attributes are rendered (coordinates via toFixed(1)) so callers can bind
 * the results straight onto <polygon> / <line> / <text> elements.
 */

/** Angle (radians) of axis `i` of `n` — axis 0 points straight up (-90°). */
function axisAngle(i, n) {
  return ((-90 + i * (360 / n)) * Math.PI) / 180;
}

/**
 * Map a command-stats snapshot onto the 5 radar axes as 0–100 percentages:
 * [emergency need, medical load, missing risk, awaiting dispatch, unaccounted gap].
 * Accepts either the disaster-scoped stats (has `checked_in`) or the global
 * stats shape (derives checked-in from safe + injured + need_help).
 */
export function radarPercentages(s) {
  const t = s.total || 1;
  const checked = s.checked_in ?? (s.safe + s.injured + s.need_help);
  return [
    s.need_help / t,
    s.injured / t,
    (s.pot_missing + s.missing_only) / t,
    s.awaiting / t,
    (t - checked) / t,
  ].map((v) => Math.min(100, Math.round(v * 100)));
}

/**
 * values: array of 0–100 percentages → "x,y x,y …" for an SVG <polygon>,
 * centred on (cx, cy) with max radius r. One vertex per value, evenly spaced.
 */
export function radarPoints(values, cx, cy, r) {
  return values
    .map((v, i) => {
      const a = axisAngle(i, values.length);
      const rr = r * (v / 100);
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Concentric grid rings — each level rendered as a regular `axes`-gon. */
export function radarRings(levels, axes, cx, cy, r) {
  return levels.map((p) => radarPoints(new Array(axes).fill(p), cx, cy, r));
}

/**
 * Axis spokes + label anchors. Returns [{ label, x2, y2, lx, ly }] where
 * (x2, y2) is the rim end of the spoke and (lx, ly) sits `labelOffset` px
 * beyond the rim for the axis label.
 */
export function radarAxisPoints(labels, cx, cy, r, labelOffset = 14) {
  return labels.map((label, i) => {
    const a = axisAngle(i, labels.length);
    return {
      label,
      x2: (cx + r * Math.cos(a)).toFixed(1),
      y2: (cy + r * Math.sin(a)).toFixed(1),
      lx: (cx + (r + labelOffset) * Math.cos(a)).toFixed(1),
      ly: (cy + (r + labelOffset) * Math.sin(a)).toFixed(1),
    };
  });
}
