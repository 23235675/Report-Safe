'use strict';

/**
 * Canonical Socket.IO event names shared by the server and all clients.
 * Keep this in sync with web/src/socket.js.
 */

const SOCKET_EVENTS = Object.freeze({
  // Client → Server
  REGISTER: 'register',

  // Server → Client
  DISASTER_ALERT:   'disaster_alert',
  LOVED_ONE_ALERT:  'loved_one_alert', // a confirmed loved one is inside an affected zone
  STATS_UPDATE:     'stats_update',
  REPORT_UPDATE:    'report_update',   // a single report status changed
  MISSING_ALERT:    'missing_alert',   // one or more reports escalated to potentially_missing
});

/** The global room every connected socket joins. */
const GLOBAL_ROOM = 'all';

module.exports = { SOCKET_EVENTS, GLOBAL_ROOM };
