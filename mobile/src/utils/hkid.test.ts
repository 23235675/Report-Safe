import { describe, it, expect } from 'vitest';
import { normalizeHKID, isValidHKID, normalizePhone } from './hkid';

describe('normalizeHKID', () => {
  it('uppercases and strips brackets/space/dash', () => {
    expect(normalizeHKID('a123456(7)')).toBe('A1234567');
    expect(normalizeHKID('A 123-456')).toBe('A123456');
  });
});

describe('isValidHKID', () => {
  it('accepts well-formed HKIDs', () => {
    expect(isValidHKID('A123456(7)')).toBe(true);
    expect(isValidHKID('AB123456')).toBe(true);
  });
  it('rejects too few digits, no letter, or bad length', () => {
    expect(isValidHKID('A12345')).toBe(false); // only 5 digits
    expect(isValidHKID('1234567')).toBe(false); // no letter
    expect(isValidHKID('A1')).toBe(false); // too short
    expect(isValidHKID('A1234567890123')).toBe(false); // too long
  });
});

describe('normalizePhone', () => {
  it('keeps last 8 digits and prefixes +852', () => {
    expect(normalizePhone('98765432')).toBe('+85298765432');
    expect(normalizePhone('+852 9876 5432')).toBe('+85298765432');
    expect(normalizePhone('852-9876-5432')).toBe('+85298765432');
  });
});
