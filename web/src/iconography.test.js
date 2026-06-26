import { describe, it, expect } from 'vitest';
import { severityRank, severityInfo, genderIcon, statusIcon, statusLabel } from './iconography.js';

// The backend sends severity as EITHER a number (3) OR a label ("high").
// severityRank normalises both so labels/colours/sort agree — guarding the
// "high < 3 = NaN" bug that silently mis-bucketed string severities.
describe('web iconography — severity normalization', () => {
  it('maps numbers through and string labels onto the same scale', () => {
    expect(severityRank(3)).toBe(3);
    expect(severityRank(5)).toBe(5);
    expect(severityRank('moderate')).toBe(3);
    expect(severityRank('high')).toBe(4);
    expect(severityRank('extreme')).toBe(5);
  });

  it('is safe on unknown/null (no NaN; buckets as lowest)', () => {
    expect(severityRank('whatever')).toBe(0);
    expect(severityRank(null)).toBe(0);
    expect(severityRank(undefined)).toBe(0);
  });

  it('lets a STRING severity sort correctly (the NaN regression)', () => {
    expect(severityRank('high')).toBeGreaterThan(severityRank('moderate'));
    expect(severityRank('extreme')).toBeGreaterThan(severityRank('high'));
  });

  it('severityInfo labels match the rank buckets for both forms', () => {
    expect(severityInfo('minor').label).toBe('Minor');
    expect(severityInfo('high').label).toBe('Severe');
    expect(severityInfo(5).label).toBe('Extreme');
  });
});

describe('web iconography — icon/label fallbacks', () => {
  it('genderIcon resolves male/female and falls back to person', () => {
    expect(genderIcon('male')).toBe('male');
    expect(genderIcon('FEMALE')).toBe('female');
    expect(genderIcon(null)).toBe('person');
  });

  it('statusIcon/statusLabel resolve known values and fall back gracefully', () => {
    expect(statusIcon('safe')).toBe('checkmark-circle');
    expect(statusIcon('unknown_status')).toBe('ellipse');
    expect(statusLabel('need_help')).toBe('Need Help');
    expect(statusLabel('weird_status')).toBe('weird status');
  });
});
