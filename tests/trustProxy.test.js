import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// O4 / guardrail #2 — with `trust proxy` = 0 (the default) a spoofed
// X-Forwarded-For must NOT become req.ip, or an attacker could set any IP and
// bypass the IP-keyed rate limits. With an explicit hop count the last
// forwarded hop IS honoured (Azure App Service = 1). Pure Express; no DB.
const express = require('express');

function appWithHops(hops) {
  const app = express();
  app.set('trust proxy', hops);
  app.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return app;
}

let s0, s1, base0, base1;

beforeAll(async () => {
  await new Promise((r) => { s0 = appWithHops(0).listen(0, r); });
  await new Promise((r) => { s1 = appWithHops(1).listen(0, r); });
  base0 = `http://127.0.0.1:${s0.address().port}`;
  base1 = `http://127.0.0.1:${s1.address().port}`;
});

afterAll(async () => {
  await new Promise((r) => s0.close(r));
  await new Promise((r) => s1.close(r));
});

describe('trust proxy hop count (guardrail #2)', () => {
  it('hops=0: a spoofed X-Forwarded-For is IGNORED (not spoofable)', async () => {
    const { ip } = await (await fetch(`${base0}/ip`, { headers: { 'X-Forwarded-For': '1.2.3.4' } })).json();
    expect(ip).not.toBe('1.2.3.4'); // resolves to the real loopback socket, not the spoof
  });

  it('hops=1: the last forwarded hop IS honoured', async () => {
    const { ip } = await (await fetch(`${base1}/ip`, { headers: { 'X-Forwarded-For': '1.2.3.4' } })).json();
    expect(ip).toBe('1.2.3.4');
  });
});
