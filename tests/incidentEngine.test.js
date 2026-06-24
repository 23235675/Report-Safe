import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// Runs against a disposable local MongoDB (see tests/_env.setup.js).
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const realtimeService = require('../server/src/services/realtimeService');
const incidentEngine = require('../server/src/services/incidentEngine');

const fakeIo = {};

/** Seed an opt-in responder + their device location. */
async function seedResponder({ id, role = 'citizen', skills, radius, lat, lng }) {
  await collection('users').insertOne({
    _id: id, phone: `+8525${id.slice(-7)}`, name: id, role,
    responder_opt_in: true, responder_skills: skills, responder_max_radius_km: radius,
    created_at: Date.now(),
  });
  await collection('device_push_tokens').insertOne({
    _id: `dev-${id}`, token: `tok-${id}`, platform: 'expo', user_id: id, lat, lng, updated_at: Date.now(),
  });
}

beforeAll(async () => { await setup(); }, 30000);

beforeEach(async () => {
  await Promise.all([
    collection('users').deleteMany({}),
    collection('device_push_tokens').deleteMany({}),
    collection('incidents').deleteMany({}),
    collection('incident_responses').deleteMany({}),
  ]);
  incidentEngine._resetCursor();
  vi.restoreAllMocks();
});

afterAll(async () => { await closeDb(); });

describe('incidentEngine.skillForType', () => {
  it('fire → fire, everything else → cpr', () => {
    expect(incidentEngine.skillForType('fire')).toBe('fire');
    expect(incidentEngine.skillForType('cardiac_arrest')).toBe('cpr');
    expect(incidentEngine.skillForType('trauma')).toBe('cpr');
    expect(incidentEngine.skillForType('other')).toBe('cpr');
  });
});

describe('incidentEngine.findRespondersInRadius', () => {
  const incident = { type: 'cardiac_arrest', lat: 22.30, lng: 114.17, is_public: true };

  it('matches an in-range CPR responder, excludes skill/radius/opt-in misses', async () => {
    await seedResponder({ id: 'resp-A-match',  skills: ['cpr', 'aed'], radius: 1.0, lat: 22.30, lng: 114.17 }); // dist ~0
    await seedResponder({ id: 'resp-B-faraway', skills: ['cpr'],       radius: 0.1, lat: 22.3045, lng: 114.17 }); // ~0.5km > 0.1km radius
    await seedResponder({ id: 'resp-C-fireonly', skills: ['fire'],     radius: 5.0, lat: 22.30, lng: 114.17 });   // wrong skill
    // Non-opt-in user nearby (must be ignored).
    await collection('users').insertOne({ _id: 'plain', phone: '+85299999999', responder_opt_in: false, created_at: Date.now() });

    const matched = await incidentEngine.findRespondersInRadius(incident);
    const ids = matched.map((m) => m.user_id).sort();
    expect(ids).toEqual(['resp-A-match']);
    expect(matched[0].devices.length).toBe(1);
    expect(matched[0].distance_km).toBeLessThan(0.05);
  });

  it('residential (is_public=false) incidents reach only government responders', async () => {
    await seedResponder({ id: 'resp-citizen', role: 'citizen',    skills: ['cpr'], radius: 2.0, lat: 22.30, lng: 114.17 });
    await seedResponder({ id: 'resp-gov',     role: 'government',  skills: ['cpr'], radius: 2.0, lat: 22.30, lng: 114.17 });

    const matched = await incidentEngine.findRespondersInRadius({ ...incident, is_public: false });
    expect(matched.map((m) => m.user_id)).toEqual(['resp-gov']);
  });
});

describe('incidentEngine.activateIncident', () => {
  it('persists the incident and alerts matched responders once', async () => {
    const spy = vi.spyOn(realtimeService, 'broadcastResponderAlert').mockImplementation(() => {});
    await seedResponder({ id: 'resp-1', skills: ['cpr'], radius: 1.0, lat: 22.30, lng: 114.17 });

    const { incident, matched } = await incidentEngine.activateIncident(
      { type: 'cardiac_arrest', lat: 22.30, lng: 114.17, is_public: true }, fakeIo
    );
    expect(incident).toBeTruthy();
    expect(incident.status).toBe('active');
    expect(matched).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await collection('incidents').countDocuments({})).toBe(1);
  });

  it('suppresses a duplicate dispatch of the same type within the dedupe radius', async () => {
    vi.spyOn(realtimeService, 'broadcastResponderAlert').mockImplementation(() => {});
    const base = { type: 'cardiac_arrest', lat: 22.30, lng: 114.17, is_public: true };

    const first = await incidentEngine.activateIncident(base, fakeIo);
    // ~50m away → inside the 150m default dedupe radius.
    const second = await incidentEngine.activateIncident({ ...base, lat: 22.3004, lng: 114.17 }, fakeIo);

    expect(first.incident).toBeTruthy();
    expect(second.incident).toBeNull();
    expect(await collection('incidents').countDocuments({})).toBe(1);
  });
});
