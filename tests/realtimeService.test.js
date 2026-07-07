import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Full coverage of the realtime HUB — the one broadcast implementation every
// emit goes through. The matching logic (identity / radius / mobile-only) runs
// against the REAL exported socketLocations map; only the Socket.IO transport
// (io.to().emit + io.fetchSockets) is faked, since that glue is not ours to test.
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const rt = require('../server/src/services/realtimeService');
const { SOCKET_EVENTS, GLOBAL_ROOM } = require('../server/src/lib/socketEvents');

// Records every .to(target).emit(event,payload); fetchSockets yields bare {id}
// objects so the hub looks each up in socketLocations.
function fakeIo(ids = []) {
  const emits = [];
  return {
    emits,
    to: (target) => ({ emit: (event, payload) => emits.push({ target, event, payload }) }),
    fetchSockets: async () => ids.map((id) => ({ id })),
  };
}

beforeAll(async () => { await setup(); }, 30000);
beforeEach(async () => {
  rt.socketLocations.clear();
  await collection('reports').deleteMany({});
  await collection('disasters').deleteMany({});
});
afterAll(async () => { rt.socketLocations.clear(); await closeDb(); });

describe('emitGlobal', () => {
  it('emits to the global room', () => {
    const io = fakeIo();
    rt.emitGlobal(io, 'ev', { a: 1 });
    expect(io.emits).toEqual([{ target: GLOBAL_ROOM, event: 'ev', payload: { a: 1 } }]);
  });
  it('is a no-op on a null io', () => {
    expect(() => rt.emitGlobal(null, 'ev', {})).not.toThrow();
  });
});

describe('emitToUsers (identity-targeted)', () => {
  it('reaches only the matching mobile user sockets', async () => {
    rt.socketLocations.set('s-match', { lat: 22.3, lng: 114.1, userType: 'mobile', userId: 'u1' });
    rt.socketLocations.set('s-other', { lat: 22.3, lng: 114.1, userType: 'mobile', userId: 'u2' });
    rt.socketLocations.set('s-web',   { lat: 22.3, lng: 114.1, userType: 'web',    userId: 'u1' });
    const io = fakeIo(['s-match', 's-other', 's-web']);
    await rt.emitToUsers(io, ['u1'], 'ev', { x: 1 });
    expect(io.emits.map((e) => e.target)).toEqual(['s-match']); // u2 by id, web-u1 by mobileOnly
  });

  it('mobileOnly:false includes a web socket (dispatcher console)', async () => {
    rt.socketLocations.set('s-web', { lat: 0, lng: 0, userType: 'web', userId: 'd1' });
    const io = fakeIo(['s-web']);
    await rt.emitToUsers(io, ['d1'], 'ev', {}, { mobileOnly: false });
    expect(io.emits.map((e) => e.target)).toEqual(['s-web']);
  });

  it('no-op for an empty user list', async () => {
    const io = fakeIo(['s1']);
    await rt.emitToUsers(io, [], 'ev', {});
    expect(io.emits).toHaveLength(0);
  });
});

describe('emitInRadius (location-targeted)', () => {
  it('reaches mobile sockets inside the radius only', async () => {
    rt.socketLocations.set('s-in',   { lat: 22.30, lng: 114.17, userType: 'mobile', userId: 'a' });
    rt.socketLocations.set('s-out',  { lat: 1.35,  lng: 103.82, userType: 'mobile', userId: 'b' }); // Singapore
    rt.socketLocations.set('s-inweb',{ lat: 22.30, lng: 114.17, userType: 'web',    userId: 'c' });
    const io = fakeIo(['s-in', 's-out', 's-inweb']);
    await rt.emitInRadius(io, { lat: 22.30, lng: 114.17 }, 25, 'ev', {});
    expect(io.emits.map((e) => e.target)).toEqual(['s-in']); // out=far, inweb=web
  });
});

describe('named broadcasts (thin wrappers over the hub)', () => {
  it('broadcastDisasterAlert → disaster_alert to in-radius mobiles', async () => {
    rt.socketLocations.set('s-in', { lat: 22.30, lng: 114.17, userType: 'mobile', userId: 'a' });
    const io = fakeIo(['s-in']);
    await rt.broadcastDisasterAlert(io, { lat: 22.30, lng: 114.17, radius_km: 10, id: 'd1' });
    expect(io.emits[0]).toMatchObject({ target: 's-in', event: SOCKET_EVENTS.DISASTER_ALERT });
  });

  it('broadcastResponderAlert → incident_alert to the matched responder', async () => {
    rt.socketLocations.set('s-r', { lat: 0, lng: 0, userType: 'mobile', userId: 'resp1' });
    const io = fakeIo(['s-r']);
    await rt.broadcastResponderAlert(io, ['resp1'], { id: 'i1' });
    expect(io.emits[0]).toMatchObject({ target: 's-r', event: SOCKET_EVENTS.INCIDENT_ALERT });
  });

  it('incidentResolved / disasterDeactivated / missingAlert → global room with ids', () => {
    const io = fakeIo();
    rt.broadcastIncidentResolved(io, 'i1');
    rt.broadcastDisasterDeactivated(io, 'd1');
    rt.broadcastMissingAlert(io, ['r1', 'r2']);
    expect(io.emits).toEqual([
      { target: GLOBAL_ROOM, event: SOCKET_EVENTS.INCIDENT_RESOLVED, payload: { id: 'i1' } },
      { target: GLOBAL_ROOM, event: SOCKET_EVENTS.DISASTER_DEACTIVATED, payload: { id: 'd1' } },
      { target: GLOBAL_ROOM, event: SOCKET_EVENTS.MISSING_ALERT, payload: { ids: ['r1', 'r2'] } },
    ]);
  });

  it('guards: null / empty ids emit nothing', () => {
    const io = fakeIo();
    rt.broadcastIncidentResolved(io, null);
    rt.broadcastMissingAlert(io, []);
    expect(io.emits).toHaveLength(0);
  });

  it('broadcastStats → stats_update with aggregate counts (web excluded)', async () => {
    await collection('reports').insertOne({
      _id: 'r1', name: 'x', name_lower: 'x', status: 'safe', lat: 22.3, lng: 114.1,
      user_type: 'mobile', created_at: Date.now(), updated_at: Date.now(),
    });
    const io = fakeIo();
    await rt.broadcastStats(io);
    const evt = io.emits.find((e) => e.event === SOCKET_EVENTS.STATS_UPDATE);
    expect(evt).toBeTruthy();
    expect(evt.target).toBe(GLOBAL_ROOM);
    expect(evt.payload.total).toBeGreaterThanOrEqual(1);
  });
});
