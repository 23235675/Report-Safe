import { describe, it, expect, vi, afterEach } from 'vitest';

// Full coverage of the structured logger + request-correlation middleware
// (M8/R10): JSON-line output, level threshold, and requestLogger assigning a
// correlation id + feeding the /api/metrics counters.
const { logger, getMetrics, requestLogger } = require('../server/src/lib/logger');

afterEach(() => vi.restoreAllMocks());

describe('logger emit (JSON lines)', () => {
  it('writes a structured info line to stdout', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.info('event_x', { a: 1 });
    expect(spy).toHaveBeenCalledTimes(1);
    const rec = JSON.parse(spy.mock.calls[0][0]);
    expect(rec).toMatchObject({ level: 'info', msg: 'event_x', a: 1 });
    expect(rec.t).toBeTruthy();
  });

  it('routes error and warn to stderr', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    logger.error('boom', {});
    logger.warn('careful', {});
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('suppresses debug below the default (info) threshold', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logger.debug('noisy');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('requestLogger + getMetrics', () => {
  it('assigns a request id, logs on finish, and increments metrics', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const before = getMetrics().requests;
    let finish;
    const req = { headers: {}, method: 'GET', path: '/x' };
    const res = { setHeader: vi.fn(), on: (ev, cb) => { if (ev === 'finish') finish = cb; }, statusCode: 200 };
    let nexted = false;
    requestLogger(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.id).toBeTruthy();
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    finish(); // simulate response completion
    expect(getMetrics().requests).toBe(before + 1);
  });

  it('propagates an incoming x-request-id', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const req = { headers: { 'x-request-id': 'given-id' }, method: 'GET', path: '/y' };
    const res = { setHeader: vi.fn(), on: () => {}, statusCode: 200 };
    requestLogger(req, res, () => {});
    expect(req.id).toBe('given-id');
  });
});
