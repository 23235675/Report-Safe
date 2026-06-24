/**
 * The backend sends disaster `severity` as EITHER a 1–5 number (3, 5) OR a
 * string label ("moderate", "high"). The app needs a single ordered scale so
 * labels, colours, and the "most severe first" sort all agree. Without this,
 * a string severity fails every numeric comparison (`"high" < 3` is NaN) and
 * silently buckets as the highest tier.
 */
export function severityRank(s: number | string | null | undefined): number {
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
    default:         return 0; // unknown → treated as minor
  }
}

/** Ordered bucket key shared by severityLabel (i18n) and severityColors (UI). */
export function severityBucket(s: number | string | null | undefined): 'minor' | 'moderate' | 'severe' | 'extreme' {
  const r = severityRank(s);
  if (r < 3) return 'minor';
  if (r < 4) return 'moderate';
  if (r < 5) return 'severe';
  return 'extreme';
}
