/**
 * Hong Kong ID validation — mirror of server/src/lib/zodSchemas.js (lenient).
 * Format-only: ≥1 letter, ≥6 digits, length 7–12. No checksum.
 */

export function normalizeHKID(raw: string): string {
  return raw.toUpperCase().replace(/[()\s-]/g, '');
}

export function isValidHKID(raw: string): boolean {
  const id = normalizeHKID(raw);
  const hasLetter = /[A-Z]/.test(id);
  const digitCount = (id.match(/\d/g) || []).length;
  const validLength = id.length >= 7 && id.length <= 12;
  return hasLetter && digitCount >= 6 && validLength;
}

/**
 * Normalise a HK phone: keep the last 8 digits, prefix +852.
 * "98765432" → "+85298765432"; "+852 9876 5432" → "+85298765432".
 * Mirrors server normalizePhone.
 */
export function normalizePhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, '');
  return `+852${digits.slice(-8)}`;
}
