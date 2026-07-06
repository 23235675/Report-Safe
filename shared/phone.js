'use strict';

/*
 * Canonical Hong Kong phone normalization — the single source of truth.
 * Server consumes this directly (lib/zodSchemas); the web and mobile clients
 * keep copies checked by scripts/check-shared-drift.mjs.
 */

/**
 * Accept 8-digit HK numbers with or without a +852 prefix; store the
 * canonical "+852XXXXXXXX" form. "+852 9876 5432" and "98765432" both
 * normalise to "+85298765432".
 */
function normalizePhone(raw) {
  const cleaned = String(raw).replace(/\D/g, ''); // keep only digits
  const eightDigits = cleaned.slice(-8);          // last 8 (strip +852 if present)
  return `+852${eightDigits}`;
}

module.exports = { normalizePhone };
