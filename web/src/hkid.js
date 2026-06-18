/**
 * Hong Kong ID card number validation — mirror of server/src/lib/zodSchemas.js.
 * VERY lenient: format-only, no checksum verification.
 */

export function normalizeHKID(raw) {
  return String(raw).toUpperCase().replace(/[()\s-]/g, '');
}

export function isValidHKID(raw) {
  const id = normalizeHKID(raw);
  // VERY lenient: at least 1 letter + 6 total digits, 7-12 chars overall.
  // Accepts A123456, AB1234567, 1A234567, etc. No checksum check.
  const hasLetter = /[A-Z]/.test(id);
  const digitCount = (id.match(/\d/g) || []).length;
  const validLength = id.length >= 7 && id.length <= 12;
  return hasLetter && digitCount >= 6 && validLength;
}

/**
 * Normalize a HK phone number: accept 8 digits, auto-prepend +852.
 * "98765432" → "+85298765432"; "+85298765432" → "+85298765432".
 * Mirrors server normalizePhone in zodSchemas.js.
 */
export function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  return `+852${digits.slice(-8)}`;
}
