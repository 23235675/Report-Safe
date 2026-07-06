// Shared-vocabulary drift check — fails CI when a client copy of the shared
// HKID/phone/status rules stops agreeing with the canonical shared/ modules.
//
//   canonical: shared/{hkid,phone,statuses}.js  (CommonJS — the server imports these)
//   web copy:  web/src/hkid.js (ESM) + web/src/iconography.js status keys
//   mobile:    mobile/src/utils/hkid.ts is TypeScript (not loadable here); its
//              behavior is pinned by mobile/src/utils/hkid.test.ts, which uses
//              the same vectors below — if mobile drifts, its own suite fails.
//
// Usage: npm run check:shared   (exit 1 on any drift)
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const require = createRequire(path.join(root, 'package.json'));

const shared = {
  hkid: require(path.join(root, 'shared', 'hkid.js')),
  phone: require(path.join(root, 'shared', 'phone.js')),
  statuses: require(path.join(root, 'shared', 'statuses.js')),
};
const webHkid = await import(pathToFileURL(path.join(root, 'web', 'src', 'hkid.js')).href);
const webIcons = await import(pathToFileURL(path.join(root, 'web', 'src', 'iconography.js')).href);

const failures = [];
const check = (label, a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures.push(`${label}: shared=${JSON.stringify(a)} client=${JSON.stringify(b)}`);
  }
};

// HKID vectors: valid & invalid under the LENIENT rule, plus normalization.
const HKID_VECTORS = ['A123456(7)', 'a1234567', 'AB987654(3)', 'C668668(1)', '1234567', 'A12345', 'ZZ99999999999', 'A-123456-7'];
for (const v of HKID_VECTORS) {
  check(`normalizeHKID(${v})`, shared.hkid.normalizeHKID(v), webHkid.normalizeHKID(v));
  check(`isValidHKID(${v})`, shared.hkid.isValidHKID(v), webHkid.isValidHKID(v));
}

// Phone vectors: 8-digit, prefixed, formatted.
const PHONE_VECTORS = ['98765432', '+85298765432', '852 9876 5432', '(852) 6111-2222'];
for (const v of PHONE_VECTORS) {
  check(`normalizePhone(${v})`, shared.phone.normalizePhone(v), webHkid.normalizePhone(v));
}

// Status vocabulary: the web colour map must cover exactly the canonical statuses.
const webStatuses = Object.keys(webIcons.STATUS_COLOR_VIVID || {}).sort();
const canonical = [...shared.statuses.REPORT_STATUSES].sort();
check('status vocabulary (iconography STATUS_COLOR_VIVID keys)', canonical, webStatuses);

if (failures.length) {
  console.error(`[check:shared] DRIFT DETECTED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('[check:shared] shared vocabulary in sync (hkid, phone, statuses)');
