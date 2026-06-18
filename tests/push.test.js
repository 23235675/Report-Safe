import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

// Azure Notification Hubs push client + radius-targeted device selection.
const { setup } = require('../server/src/db/setup');
const { collection, closeDb } = require('../server/src/db/mongo');
const pushService = require('../server/src/lib/pushService');
const triggerEngine = require('../server/src/services/triggerEngine');

beforeAll(async () => { await setup(); }, 30000);
beforeEach(async () => { await collection('device_push_tokens').deleteMany({}); });
afterAll(async () => { await closeDb(); });

describe('pushService config + payload', () => {
  it('parses an Azure connection string', () => {
    const cs = 'Endpoint=sb://my-ns.servicebus.windows.net/;SharedAccessKeyName=DefaultFullSharedAccessSignature;SharedAccessKey=abc123==';
    const p = pushService.parseConnectionString(cs);
    expect(p.endpoint).toBe('sb://my-ns.servicebus.windows.net/');
    expect(p.keyName).toBe('DefaultFullSharedAccessSignature');
    expect(p.key).toBe('abc123==');
  });

  it('builds a SAS token of the expected shape', () => {
    const sas = pushService.createSasToken('https://my-ns.servicebus.windows.net/hub', 'KeyName', 'secretkey');
    expect(sas).toMatch(/^SharedAccessSignature /);
    expect(sas).toMatch(/sr=/);
    expect(sas).toMatch(/sig=/);
    expect(sas).toMatch(/skn=KeyName/);
  });

  it('builds platform-specific payloads', () => {
    const d = { id: 'd1', type: 'typhoon', description: 'T10 in force' };
    expect(pushService.buildPayload('ios', d).format).toBe('apple');
    expect(pushService.buildPayload('android', d).format).toBe('gcm');
    // APNs body carries an aps block; FCM body carries a notification block
    expect(pushService.buildPayload('ios', d).json).toMatch(/aps/);
    expect(pushService.buildPayload('android', d).json).toMatch(/notification/);
  });

  it('is a graceful no-op when unconfigured', async () => {
    const prevCs = process.env.AZURE_NH_CONNECTION_STRING;
    const prevHub = process.env.AZURE_NH_HUB_NAME;
    delete process.env.AZURE_NH_CONNECTION_STRING;
    delete process.env.AZURE_NH_HUB_NAME;
    const res = await pushService.sendDisasterPush({ id: 'd1', type: 'flood' }, [{ token: 'x', platform: 'android' }]);
    expect(res.configured).toBe(false);
    expect(res.sent).toBe(0);
    if (prevCs) process.env.AZURE_NH_CONNECTION_STRING = prevCs;
    if (prevHub) process.env.AZURE_NH_HUB_NAME = prevHub;
  });
});

describe('findDevicesInRadius', () => {
  async function addDevice(id, token, lat, lng) {
    const now = Date.now();
    await collection('device_push_tokens').insertOne({
      _id: id, token, platform: 'android', lat, lng, created_at: now, updated_at: now,
    });
  }

  it('selects only devices inside the disaster radius', async () => {
    await addDevice('near', 'tok-near', 22.302, 114.177); // central HK
    await addDevice('far',  'tok-far',  0,      0);        // Gulf of Guinea
    const devices = await triggerEngine.findDevicesInRadius({ lat: 22.302, lng: 114.177, radius_km: 10 });
    const tokens = devices.map((d) => d.token);
    expect(tokens).toContain('tok-near');
    expect(tokens).not.toContain('tok-far');
  });

  it('ignores devices with no stored location', async () => {
    const now = Date.now();
    await collection('device_push_tokens').insertOne({
      _id: 'noloc', token: 'tok-noloc', platform: 'android', lat: null, lng: null, created_at: now, updated_at: now,
    });
    const devices = await triggerEngine.findDevicesInRadius({ lat: 22.302, lng: 114.177, radius_km: 50 });
    expect(devices.map((d) => d.token)).not.toContain('tok-noloc');
  });
});
