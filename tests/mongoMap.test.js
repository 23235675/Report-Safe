import { describe, it, expect } from 'vitest';

// P3 — the shared Mongo mapping helpers. `ilike` in particular is the injection
// guard behind admin/link search (a user-supplied string must match literally,
// never as a regex); `pickProvided` is the one partial-update helper.
const { mapId, unwrap, escapeRegex, ilike, pickProvided } = require('../server/src/lib/mongoMap');

describe('mapId', () => {
  it('renames _id → id and keeps the rest', () => {
    expect(mapId({ _id: 'x', a: 1 })).toEqual({ id: 'x', a: 1 });
  });
  it('is null-safe', () => {
    expect(mapId(null)).toBeNull();
  });
});

describe('unwrap (driver v5/v6 findOneAnd* compat)', () => {
  it('unwraps a { value } envelope', () => {
    expect(unwrap({ value: { a: 1 } })).toEqual({ a: 1 });
  });
  it('passes a bare doc through', () => {
    expect(unwrap({ a: 1 })).toEqual({ a: 1 });
  });
  it('returns null for a { value: null } envelope', () => {
    expect(unwrap({ value: null })).toBeNull();
  });
});

describe('escapeRegex / ilike (injection safety)', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a.*b')).toBe('a\\.\\*b');
  });
  it('matches literally + case-insensitively — no regex injection', () => {
    const rx = ilike('a.b');
    expect(rx.test('a.b')).toBe(true);
    expect(rx.test('aXb')).toBe(false); // '.' is literal, not "any char"
    expect(ilike('MEI').test('mei wong')).toBe(true);
  });
});

describe('pickProvided (COALESCE-style partial update)', () => {
  it('keeps only listed fields that are non-null/undefined (0 and "" survive)', () => {
    const out = pickProvided({ a: 1, b: null, c: undefined, d: 0, e: 'x', z: 9 }, ['a', 'b', 'c', 'd', 'e']);
    expect(out).toEqual({ a: 1, d: 0, e: 'x' }); // b/c dropped (null/undef); z not listed
  });
});
