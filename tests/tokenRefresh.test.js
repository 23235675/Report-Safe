import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// H4/B14 — refresh-token rotation WITH reuse detection. Mounts the users router.
const express = require('express');
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const createUsersRouter = require('../server/src/routes/users');

let server, base;

beforeAll(async () => {
  await setup();
  const app = express();
  app.use(express.json());
  app.use('/api/users', createUsersRouter());
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 30000);

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeDb();
});

beforeEach(async () => { await collection('users').deleteMany({}); });

const j = (path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

async function register() {
  const { body } = await j('/api/users/register', {
    phone: '98765432', name: 'Rotater', gender: 'male', personal_id: 'A1234567', privacy_consent: true,
  });
  return body; // { access_token, refresh_token, ... }
}

describe('H4: refresh rotation + reuse detection', () => {
  it('rotates: a fresh refresh token mints a new pair and invalidates the old', async () => {
    const reg = await register();
    const first = await j('/api/users/token/refresh', { refresh_token: reg.refresh_token });
    expect(first.status).toBe(200);
    expect(first.body.refresh_token).toBeTruthy();
    expect(first.body.refresh_token).not.toBe(reg.refresh_token);

    // The ORIGINAL token is now the previous one — replaying it is reuse.
    const replay = await j('/api/users/token/refresh', { refresh_token: reg.refresh_token });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('token_reuse');
  });

  it('H3: register sets an httpOnly refresh cookie that refresh accepts without a body', async () => {
    const reg = await fetch(`${base}/api/users/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '98765433', name: 'Cookie', gender: 'female', personal_id: 'A1234568', privacy_consent: true }),
    });
    const setCookie = reg.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/rs_refresh=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const cookie = setCookie.split(';')[0]; // rs_refresh=<token>
    const refreshed = await fetch(`${base}/api/users/token/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}',
    });
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json()).access_token).toBeTruthy();
  });

  it('reuse nukes the family: the just-rotated token stops working too', async () => {
    const reg = await register();
    const rotated = await j('/api/users/token/refresh', { refresh_token: reg.refresh_token });
    // Trip reuse with the old token...
    await j('/api/users/token/refresh', { refresh_token: reg.refresh_token });
    // ...now even the legitimately-rotated token is dead (family invalidated).
    const after = await j('/api/users/token/refresh', { refresh_token: rotated.body.refresh_token });
    expect(after.status).toBe(401);
  });
});
