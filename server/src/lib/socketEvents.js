'use strict';

/**
 * Canonical Socket.IO event names shared by the server and all clients.
 * Keep this in sync with web/src/socket.js.
 */

const SOCKET_EVENTS = Object.freeze({
  // Client → Server
  REGISTER: 'register',

  // Server → Client
  DISASTER_ALERT:       'disaster_alert',
  DISASTER_DEACTIVATED: 'disaster_deactivated', // a disaster was ended (B20)
  LOVED_ONE_ALERT:      'loved_one_alert', // a confirmed loved one is inside an affected zone
  STATS_UPDATE:         'stats_update',
  MISSING_ALERT:        'missing_alert',   // one or more reports escalated to potentially_missing
  // CFR (Community First Responder) — opt-in, NON-gating (unlike disaster_alert)
  INCIDENT_ALERT:       'incident_alert',   // a 999/CAD dispatch is near an opted-in responder
  INCIDENT_UPDATE:      'incident_update',  // a co-responder changed status / position
  INCIDENT_RESOLVED:    'incident_resolved',// dispatch resolved / stood down the incident
});

/** The global room every connected socket joins. */
const GLOBAL_ROOM = 'all';

module.exports = { SOCKET_EVENTS, GLOBAL_ROOM };
