'use strict';

/*
 * Canonical HKID validation — the single source of truth (PCPD Code of
 * Practice on Personal Identifiers applies; never expose an HKID publicly).
 * Server consumes this directly (lib/zodSchemas). web/src/hkid.js and
 * mobile/src/utils/hkid.ts keep client copies of the LENIENT rule;
 * scripts/check-shared-drift.mjs fails CI if the web copy's behavior drifts.
 */

/**
 * Normalised storage form: strip parentheses/spaces/dashes and uppercase.
 * "A123456(7)" → "A1234567".
 */
function normalizeHKID(raw) {
  return String(raw).toUpperCase().replace(/[()\s-]/g, '');
}

/**
 * LENIENT validation (the default): accepts almost any mix of letters and
 * digits (7–12 chars, ≥1 letter, ≥6 digits) so testers don't need a real ID.
 */
function isValidHKID(raw) {
  const id = normalizeHKID(raw);
  const hasLetter = /[A-Z]/.test(id);
  const digitCount = (id.match(/\d/g) || []).length;
  const validLength = id.length >= 7 && id.length <= 12;
  return hasLetter && digitCount >= 6 && validLength;
}

/**
 * STRICT validation — the real HK mod-11 check-digit algorithm (the
 * production rule, enforced when HKID_STRICT=true). Letters map A=10…Z=35; a
 * single-letter prefix is treated as a leading space valued 36; weights 9..2
 * run over the 8 positions (2 letter slots + 6 digits); the total including
 * the check digit (value 10 = "A") must be ≡ 0 (mod 11).
 */
function isValidHKIDChecksum(raw) {
  const id = normalizeHKID(raw);
  const m = /^([A-Z]{1,2})(\d{6})([0-9A])$/.exec(id);
  if (!m) return false;
  const [, letters, digits, checkChar] = m;
  const charVal = (c) => c.charCodeAt(0) - 55; // 'A'(65) -> 10 … 'Z'(90) -> 35

  let sum;
  if (letters.length === 1) {
    sum = 36 * 9 + charVal(letters[0]) * 8;     // leading "space" (36) + letter
  } else {
    sum = charVal(letters[0]) * 9 + charVal(letters[1]) * 8;
  }
  for (let i = 0; i < 6; i++) sum += Number(digits[i]) * (7 - i); // weights 7..2
  sum += (checkChar === 'A' ? 10 : Number(checkChar));            // check digit, weight 1
  return sum % 11 === 0;
}

module.exports = { normalizeHKID, isValidHKID, isValidHKIDChecksum };
