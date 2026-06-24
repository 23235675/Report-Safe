'use strict';

/*
 * Shared MongoDB helpers (L4). These four were independently re-defined in six
 * files (admin, users, safePlaces, shelters, disasters, reportStore) and had
 * begun to drift. One canonical copy means a fix lands once.
 */

/** Map a stored doc's `_id` → `id` (null-safe). */
function mapId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

/** Driver v6 findOneAnd* returns the doc directly; v5 wrapped it in `{ value }`. */
function unwrap(res) {
  return res && res.value !== undefined ? res.value : res;
}

/** Escape a string for safe use inside a MongoDB `$regex`. */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive substring match (the former SQL `ILIKE '%q%'`). */
function ilike(q) {
  return new RegExp(escapeRegex(q), 'i');
}

module.exports = { mapId, unwrap, escapeRegex, ilike };
