import { describe, it, expect } from 'vitest';
import { normalizeHKID, isValidHKID, normalizePhone } from './hkid.js';

// Web mirror of server/src/lib/zodSchemas.js — these run on the register path,
// so the web client must accept/reject exactly what the server does.
describe('web hkid', () => {
  it('normalizeHKID strips brackets/spaces/dashes and uppercases', () => {
    expect(normalizeHKID('a123456(3)')).toBe('A1234563');
    expect(normalizeHKID(' ab-123 456 ')).toBe('AB123456');
  });

  it('isValidHKID accepts lenient formats (1+ letter, 6+ digits, 7–12 chars)', () => {
    for (const ok of ['A123456', 'AB1234567', '1A234567', 'A123456(3)']) {
      expect(isValidHKID(ok)).toBe(true);
    }
  });

  it('isValidHKID rejects no-letter, too-short, and empty', () => {
    for (const bad of ['1234567', 'A12', '', 'AB']) {
      expect(isValidHKID(bad)).toBe(false);
    }
  });

  it('normalizePhone keeps the last 8 digits and prepends +852', () => {
    expect(normalizePhone('98765432')).toBe('+85298765432');
    expect(normalizePhone('+852 9876 5432')).toBe('+85298765432');
    expect(normalizePhone('852-98765432')).toBe('+85298765432');
  });
});
