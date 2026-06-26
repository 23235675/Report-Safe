import { describe, it, expect } from 'vitest';

const {
  isValidHKID,
  normalizeHKID,
  ReportSchema,
  UserRegisterSchema,
} = require('../server/src/lib/zodSchemas');

describe('HKID validation', () => {
  // Reference numbers with correct check digits (synthetic).
  // A123456(3): space(36)*9 + A(10)*8 + 1*7+2*6+3*5+4*4+5*3+6*2 = 324+80+7+12+15+16+15+12 = 481; 481 % 11 = 8; check = 3. ✓
  it('accepts a valid single-letter HKID', () => {
    expect(isValidHKID('A123456(3)')).toBe(true);
    expect(isValidHKID('A1234563')).toBe(true);   // without parentheses
    expect(isValidHKID('a123456(3)')).toBe(true); // lowercase normalised
  });

  it('accepts any format-valid HKID (lenient, no checksum verify)', () => {
    // Relaxed validation: accepts 1-2 letters + 6-7 digits, regardless of check digit
    expect(isValidHKID('A123456(4)')).toBe(true);   // even wrong check digit
    expect(isValidHKID('A1234567')).toBe(true);     // 7 digits, no checksum
    expect(isValidHKID('AB1234567')).toBe(true);    // 2-letter prefix
  });

  it('rejects clearly invalid input (no letters, too short, or too long)', () => {
    expect(isValidHKID('')).toBe(false);                  // empty
    expect(isValidHKID('1234567')).toBe(false);           // no letter (only 7 digits)
    expect(isValidHKID('ABCDEFGHIJ123')).toBe(false);     // too long (13 chars)
    expect(isValidHKID('A12345')).toBe(false);            // too short (6 chars, only 5 digits)
  });

  it('accepts very lenient HKID (1+ letter, 6+ digits, 7-12 chars)', () => {
    // All now valid: format-only, no checksum, flexible letter placement
    expect(isValidHKID('ABC123456')).toBe(true);   // 3-letter prefix (now OK)
    expect(isValidHKID('1A234567')).toBe(true);    // digit first
    expect(isValidHKID('A1B2C3D456')).toBe(true);  // mixed (now OK)
  });

  it('accepts a check digit of A (value 10)', () => {
    // Find a body whose check digit is A by brute force, then assert.
    let found = null;
    outer: for (let d = 0; d <= 999999; d++) {
      const digits = String(d).padStart(6, '0');
      let sum = 36 * 9 + (65 - 55) * 8; // 'A' prefix
      for (let i = 0; i < 6; i++) sum += Number(digits[i]) * (7 - i);
      if ((11 - (sum % 11)) % 11 === 10) { found = `A${digits}A`; break outer; }
    }
    expect(found).toBeTruthy();
    expect(isValidHKID(found)).toBe(true);
  });

  it('normalises to uppercase without punctuation', () => {
    expect(normalizeHKID('a123456(3)')).toBe('A1234563');
    expect(normalizeHKID(' A123456-3 ')).toBe('A1234563');
  });
});

describe('ReportSchema with identity fields', () => {
  const base = {
    name: 'Mei Wong',
    status: 'safe',
    lat: 22.3,
    lng: 114.1,
  };

  it('accepts a report with valid HKID and normalises it', () => {
    const r = ReportSchema.safeParse({ ...base, personal_id: 'a123456(3)', phone: '+85291234567' });
    expect(r.success).toBe(true);
    expect(r.data.personal_id).toBe('A1234563');
  });

  it('accepts a report with lenient HKID (format-only validation)', () => {
    // With lenient validation, even format-valid but checksum-invalid HKIDs are accepted
    const r = ReportSchema.safeParse({ ...base, personal_id: 'A123456(4)' });
    expect(r.success).toBe(true);

    // But still rejects completely malformed HKID
    const bad = ReportSchema.safeParse({ ...base, personal_id: '123456' });
    expect(bad.success).toBe(false);
  });

  it('still accepts a report WITHOUT phone/personal_id (never-lose-a-report: legacy outbox + mesh relays)', () => {
    const r = ReportSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('accepts and defaults user_type', () => {
    expect(ReportSchema.safeParse({ ...base, user_type: 'web' }).data.user_type).toBe('web');
    expect(ReportSchema.safeParse(base).data.user_type).toBeUndefined(); // store defaults to 'mobile'
  });
});

describe('UserRegisterSchema — registration requires phone + name + HKID + consent', () => {
  it('requires full name', () => {
    const r = UserRegisterSchema.safeParse({ phone: '+85291234567', personal_id: 'A123456(3)', privacy_consent: true });
    expect(r.success).toBe(false);
  });

  it('requires personal_id (HKID) to be provided', () => {
    const r = UserRegisterSchema.safeParse({ phone: '+85291234567', name: 'Mei Wong', privacy_consent: true });
    expect(r.success).toBe(false);  // missing HKID
  });

  it('accepts lenient HKID formats (1+ letter + 6+ digits)', () => {
    const tests = [
      { phone: '+85291234567', name: 'Mei Wong', gender: 'female', personal_id: 'A123456', privacy_consent: true },     // minimal
      { phone: '+85291234567', name: 'Mei Wong', gender: 'female', personal_id: 'AB1234567', privacy_consent: true },   // 2 letters
      { phone: '+85291234567', name: 'Mei Wong', gender: 'female', personal_id: '1A234567', privacy_consent: true },    // digit first
      { phone: '+85291234567', name: 'Mei Wong', gender: 'female', personal_id: 'A1234567890', privacy_consent: true }, // 10 chars
    ];
    tests.forEach((t) => {
      const r = UserRegisterSchema.safeParse(t);
      expect(r.success).toBe(true);
    });
  });

  it('requires gender', () => {
    const r = UserRegisterSchema.safeParse({ phone: '+85291234567', name: 'Mei Wong', personal_id: 'A123456(3)', privacy_consent: true });
    expect(r.success).toBe(false);  // missing gender
  });

  it('requires privacy_consent = true (PDPO DPP1)', () => {
    const base = { phone: '+85291234567', name: 'Mei Wong', gender: 'female', personal_id: 'A123456(3)' };
    expect(UserRegisterSchema.safeParse(base).success).toBe(false); // missing consent
    expect(UserRegisterSchema.safeParse({ ...base, privacy_consent: false }).success).toBe(false);
    expect(UserRegisterSchema.safeParse({ ...base, privacy_consent: true }).success).toBe(true);
  });

  it('accepts a complete registration (with consent)', () => {
    const r = UserRegisterSchema.safeParse({
      phone: '+85291234567',
      name: 'Mei Wong',
      gender: 'female',
      personal_id: 'A123456(3)',
      privacy_consent: true,
    });
    expect(r.success).toBe(true);
    expect(r.data.personal_id).toBe('A1234563');
  });
});
