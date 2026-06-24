'use strict';

const crypto = require('crypto');
const { logger } = require('./logger');

/*
 * Remote push via Azure Notification Hubs (REST, dependency-free).
 *
 * WHY: the Socket.IO `disaster_alert` only reaches apps that are currently
 * RUNNING. A disaster can strike while a phone's app is closed — so we also push
 * a native notification through Azure Notification Hubs, which fans out to
 * FCM (Android) and APNs (iOS). This wakes a closed app and drives the user into
 * the disaster-mode gate.
 *
 * TARGETING: we "direct send" to the specific device handles we selected by
 * radius (see triggerEngine.findDevicesInRadius) rather than broadcasting to the
 * whole hub — so only phones actually inside the affected zone are alerted.
 *
 * CONFIG (all optional — absent = graceful no-op, like the Redis path):
 *   AZURE_NH_CONNECTION_STRING  Endpoint=sb://<ns>.servicebus.windows.net/;
 *                               SharedAccessKeyName=<name>;SharedAccessKey=<key>
 *   AZURE_NH_HUB_NAME           the notification hub name
 *
 * PRODUCTION NOTE: Azure NH must be wired to your FCM (v1) credentials and an
 * APNs key/certificate in the Azure portal for delivery to actually occur.
 */

const API_VERSION = '2015-01';

/** Parse an Azure Service Bus / Notification Hubs connection string. */
function parseConnectionString(cs) {
  const out = {};
  for (const part of String(cs).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === 'Endpoint') out.endpoint = val;
    else if (key === 'SharedAccessKeyName') out.keyName = val;
    else if (key === 'SharedAccessKey') out.key = val;
  }
  return out;
}

function isConfigured() {
  return Boolean(process.env.AZURE_NH_CONNECTION_STRING && process.env.AZURE_NH_HUB_NAME);
}

/**
 * Build a SAS token for the hub resource URI (HMAC-SHA256 over the URI + expiry).
 * @returns {string} the `SharedAccessSignature ...` Authorization header value
 */
function createSasToken(resourceUri, keyName, key, ttlSeconds = 3600) {
  const encoded = encodeURIComponent(resourceUri.toLowerCase());
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const stringToSign = `${encoded}\n${expiry}`;
  const sig = crypto.createHmac('sha256', key).update(stringToSign).digest('base64');
  return `SharedAccessSignature sr=${encoded}&sig=${encodeURIComponent(sig)}&se=${expiry}&skn=${keyName}`;
}

/** Platform-specific notification body for a disaster. */
function buildPayload(platform, disaster) {
  const type = (disaster.type || 'Disaster').replace(/^\w/, (c) => c.toUpperCase());
  const title = `⚠️ ${type} alert — you are in the affected area`;
  const body =
    disaster.description ||
    'A disaster has been declared in your area. Open Report Safe and confirm your safety now.';

  if (platform === 'ios') {
    return {
      format: 'apple',
      json: JSON.stringify({
        aps: { alert: { title, body }, sound: 'default', 'mutable-content': 1 },
        disasterId: disaster.id,
      }),
    };
  }
  // android (FCM legacy JSON) — also the default for unknown native handles
  return {
    format: 'gcm',
    json: JSON.stringify({
      notification: { title, body },
      data: { disasterId: String(disaster.id), type: 'disaster_alert' },
      priority: 'high',
    }),
  };
}

/**
 * Platform-specific "your loved one may be affected" notification.
 *
 * Sent to a relative whose CONFIRMED linked contact is inside a disaster zone.
 * The recipient is NOT in the zone, so the payload is typed `loved_one_alert`
 * (not `disaster_alert`): the app shows the notification and surfaces the
 * person's status but MUST NOT enter disaster mode — only the affected person
 * does that.
 */
function buildLovedOnePayload(platform, disaster, affectedName) {
  const type = (disaster.type || 'disaster').toLowerCase();
  const who = affectedName || 'Your contact';
  const title = `⚠️ ${who} may be in an affected area`;
  const body =
    `A ${type} alert covers ${who}'s area. Open Report Safe to see their status.`;

  if (platform === 'ios') {
    return {
      format: 'apple',
      json: JSON.stringify({
        aps: { alert: { title, body }, sound: 'default', 'mutable-content': 1 },
        disasterId: disaster.id,
        type: 'loved_one_alert',
        affectedName: who,
      }),
    };
  }
  // android (FCM legacy JSON) — also the default for unknown native handles
  return {
    format: 'gcm',
    json: JSON.stringify({
      notification: { title, body },
      data: {
        disasterId: String(disaster.id),
        type: 'loved_one_alert',
        affectedName: String(who),
      },
      priority: 'high',
    }),
  };
}

/**
 * CFR: platform-specific "a nearby emergency needs you" notification for an
 * opted-in responder. Typed `incident_alert` so the app routes it to the
 * responder screen — it is NON-gating (never enters disaster mode). Carries
 * incidentId so a tap (incl. cold-start) opens that incident.
 */
function buildResponderPayload(platform, incident) {
  const label = incident.type === 'cardiac_arrest' ? 'Cardiac arrest'
    : incident.type === 'fire' ? 'Fire'
    : incident.type === 'trauma' ? 'Trauma' : 'Emergency';
  const title = `🚑 ${label} nearby — help needed now`;
  const body = 'Someone near you needs help before the ambulance arrives. Tap to respond.';

  if (platform === 'ios') {
    return {
      format: 'apple',
      json: JSON.stringify({
        aps: { alert: { title, body }, sound: 'default', 'mutable-content': 1 },
        incidentId: incident.id,
        type: 'incident_alert',
      }),
    };
  }
  // android (FCM legacy JSON) — also the default for unknown native handles
  return {
    format: 'gcm',
    json: JSON.stringify({
      notification: { title, body },
      data: { incidentId: String(incident.id), type: 'incident_alert' },
      priority: 'high',
    }),
  };
}

/**
 * Direct-send one notification to a single device handle.
 * @returns {Promise<{ok:boolean, stale:boolean}>} ok = delivered to the hub
 *   (not an end-to-end receipt); stale = the handle is gone and should be pruned.
 */
async function sendToDevice({ url, authorization }, device, payload) {
  // Expo Go tokens (ExponentPushToken[...]) are not FCM/APNs handles and can't
  // be sent via Azure NH — they require Expo's own push service. Skip cleanly.
  if (device.platform === 'expo') return { ok: false, stale: false };

  const { format, json } = payload;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': format === 'apple' ? 'application/json' : 'application/json;charset=utf-8',
      'ServiceBusNotification-Format': format,
      'ServiceBusNotification-DeviceHandle': device.token,
      'X-NH-Direct': 'true',
    },
    body: json,
  });

  if (res.status >= 200 && res.status < 300) return { ok: true, stale: false };
  // 410 Gone / 404 = the handle was unregistered or expired → prune it.
  const stale = res.status === 410 || res.status === 404;
  logger.warn('push_send_non_2xx', { status: res.status, platform: device.platform, stale });
  return { ok: false, stale };
}

/**
 * Shared fan-out: resolve hub config once, send a per-device payload to every
 * handle, tally results, and collect dead handles to prune. Graceful no-op when
 * unconfigured. Both the direct disaster push and the loved-one cascade use this.
 * @param {Array<{token:string, platform:string}>} devices
 * @param {(device:object) => {format:string, json:string}} payloadFor builds each handle's payload
 * @param {string} logLabel structured-log key for the batch result
 * @param {object} [logMeta] extra fields to include in the result log
 */
async function dispatchPush(devices, payloadFor, logLabel, logMeta = {}) {
  if (!isConfigured()) {
    logger.info('push_skipped_unconfigured', { devices: devices?.length || 0 });
    return { configured: false, sent: 0, failed: 0, skipped: devices?.length || 0, deadTokens: [] };
  }
  if (!devices || devices.length === 0) {
    return { configured: true, sent: 0, failed: 0, skipped: 0, deadTokens: [] };
  }

  const conn = parseConnectionString(process.env.AZURE_NH_CONNECTION_STRING);
  const ctx = { ...conn, hub: process.env.AZURE_NH_HUB_NAME };
  if (!ctx.endpoint || !ctx.keyName || !ctx.key) {
    logger.error('push_bad_connection_string');
    return { configured: false, sent: 0, failed: 0, skipped: devices.length, deadTokens: [] };
  }

  // Per-batch constants (endpoint/hub/key are fixed for the whole fan-out): build
  // the request URL and SAS token ONCE rather than recomputing them for every
  // device. The SAS token's 1h TTL covers the entire (concurrent, sub-second)
  // batch, so every handle is authorized identically to the prior per-device path.
  const sbEndpoint = ctx.endpoint.replace(/^sb:\/\//, 'https://').replace(/\/$/, '');
  const sendCtx = {
    url: `${sbEndpoint}/${ctx.hub}/messages/?api-version=${API_VERSION}&direct`,
    authorization: createSasToken(`${sbEndpoint}/${ctx.hub}`, ctx.keyName, ctx.key),
  };

  const results = await Promise.allSettled(
    devices.map((d) => sendToDevice(sendCtx, d, payloadFor(d)))
  );

  let sent = 0, failed = 0, skipped = 0;
  const deadTokens = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      if (r.value.ok) sent++;
      else if (devices[i].platform === 'expo') skipped++;
      else {
        failed++;
        if (r.value.stale) deadTokens.push(devices[i].token);
      }
    } else {
      failed++;
      logger.warn('push_send_rejected', { error: r.reason?.message });
    }
  }
  logger.info(logLabel, { ...logMeta, sent, failed, skipped, dead: deadTokens.length });
  return { configured: true, sent, failed, skipped, deadTokens };
}

/**
 * Push a disaster alert to devices INSIDE the affected zone (the affected people
 * themselves) — drives their disaster-mode gate. Graceful no-op when unconfigured.
 * @param {object} disaster
 * @param {Array<{token:string, platform:string}>} devices
 * @returns {Promise<{configured:boolean, sent:number, failed:number, skipped:number, deadTokens:string[]}>}
 */
async function sendDisasterPush(disaster, devices) {
  return dispatchPush(
    devices,
    (d) => buildPayload(d.platform, disaster),
    'push_disaster_sent',
    { disasterId: disaster.id }
  );
}

/**
 * Cascade a "your loved one may be affected" alert to relatives' devices. These
 * recipients are NOT in the zone — the typed payload keeps them OUT of disaster
 * mode while still surfacing the affected person's status. Graceful no-op when
 * unconfigured.
 * @param {object} disaster
 * @param {Array<{token:string, platform:string, affectedName:string}>} recipients
 */
async function sendLovedOneAlert(disaster, recipients) {
  return dispatchPush(
    recipients,
    (r) => buildLovedOnePayload(r.platform, disaster, r.affectedName),
    'push_loved_one_sent',
    { disasterId: disaster.id }
  );
}

/**
 * CFR: push an incident alert to the device handles of matched responders (the
 * closed-app path; the socket covers open apps). Graceful no-op when unconfigured.
 * @param {object} incident
 * @param {Array<{token:string, platform:string}>} devices
 */
async function sendResponderAlert(incident, devices) {
  return dispatchPush(
    devices,
    (d) => buildResponderPayload(d.platform, incident),
    'push_responder_sent',
    { incidentId: incident.id }
  );
}

module.exports = {
  isConfigured,
  sendDisasterPush,
  sendLovedOneAlert,
  sendResponderAlert,
  parseConnectionString,
  createSasToken,
  buildPayload,
  buildLovedOnePayload,
  buildResponderPayload,
};
