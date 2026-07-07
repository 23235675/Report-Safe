import { describe, it, expect } from 'vitest';

// P3 — the one error path. A 4xx HttpError surfaces its message + code; anything
// else (incl. a thrown 500) is masked to a generic body with a reqId and NO
// stack — the "never leak internals to the client" guarantee.
const { errorHandler } = require('../server/src/lib/errorHandler');
const { HttpError } = require('../server/src/lib/http');

function fakeRes() {
  return {
    statusCode: 0, body: null, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const req = { id: 'req-42', method: 'GET', path: '/x', auth: null };

describe('errorHandler', () => {
  it('exposes a 4xx HttpError: message + code + reqId', () => {
    const res = fakeRes();
    errorHandler(new HttpError(400, 'bad thing', 'my_code'), req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'bad thing', code: 'my_code', reqId: 'req-42' });
  });

  it('masks a generic 500 — no original message, no stack', () => {
    const res = fakeRes();
    errorHandler(new Error('secret db connection string'), req, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', reqId: 'req-42' });
    expect(JSON.stringify(res.body)).not.toMatch(/secret db connection string/);
    expect(res.body.stack).toBeUndefined();
  });

  it('masks a thrown HttpError(500) too (expose is false for 5xx)', () => {
    const res = fakeRes();
    errorHandler(new HttpError(500, 'internal detail'), req, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Internal server error');
  });

  it('delegates to next(err) when headers were already sent', () => {
    const res = fakeRes(); res.headersSent = true;
    const err = new HttpError(400, 'x');
    let passed = null;
    errorHandler(err, req, res, (e) => { passed = e; });
    expect(passed).toBe(err);
  });

  it('includes field details on an exposed error when present (validation path)', () => {
    const res = fakeRes();
    const err = new HttpError(400, 'Validation failed', 'validation');
    err.details = [{ path: ['phone'], message: 'Required' }];
    errorHandler(err, req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Validation failed', code: 'validation', details: err.details, reqId: 'req-42' });
  });
});
