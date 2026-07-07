import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// F-1 fix — validate() now routes its 400 through the central errorHandler, so a
// validation failure carries the reqId correlation id (like every other error)
// and a consistent envelope, while still exposing the field-level `details` that
// web/mobile surface as inline messages. No DB needed.
const express = require('express');
const { validate, asyncHandler } = require('../server/src/lib/http');
const { errorHandler } = require('../server/src/lib/errorHandler');
const { LoginSchema } = require('../server/src/lib/zodSchemas');

let server, base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.id = 'test-req-id'; next(); }); // stand in for requestLogger
  app.post('/v', validate(LoginSchema), asyncHandler(async (req, res) => res.json({ ok: true })));
  app.use(errorHandler);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => { await new Promise((r) => server.close(r)); });

const post = (body) => fetch(`${base}/v`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

describe('validate() → errorHandler (consistent envelope + reqId)', () => {
  it('a bad body → 400 carrying error, code, reqId, and field details', async () => {
    const res = await post('{}'); // missing phone
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.code).toBe('validation');
    expect(body.reqId).toBe('test-req-id');           // the fix — reqId now present
    expect(Array.isArray(body.details)).toBe(true);   // preserved for client inline messages
    expect(body.details[0].path).toContain('phone');
  });

  it('a valid body passes through to the handler', async () => {
    const res = await post(JSON.stringify({ phone: '98765432' }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
