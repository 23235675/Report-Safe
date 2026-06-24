import { describe, it, expect } from 'vitest';
import { severityRank, severityBucket } from './severity';

describe('severityRank', () => {
  it('passes through finite numbers', () => {
    expect(severityRank(3)).toBe(3);
    expect(severityRank(5)).toBe(5);
  });
  it('maps string labels (the bug: these used to be NaN)', () => {
    expect(severityRank('moderate')).toBe(3);
    expect(severityRank('high')).toBe(4);
    expect(severityRank('HIGH')).toBe(4);
  });
  it('unknown/null → 0', () => {
    expect(severityRank(null)).toBe(0);
    expect(severityRank('???')).toBe(0);
  });
});

describe('severityBucket', () => {
  it('buckets numbers and strings consistently', () => {
    expect(severityBucket(5)).toBe('extreme');
    expect(severityBucket('moderate')).toBe('moderate'); // was wrongly "extreme"
    expect(severityBucket('high')).toBe('severe');
    expect(severityBucket(3)).toBe('moderate');
    expect(severityBucket(null)).toBe('minor');
  });
});
