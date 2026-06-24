import { io } from 'socket.io-client';
import { ref } from 'vue';

// Keep in sync with server/src/lib/socketEvents.js. (L3: report_update removed —
// it was never emitted; disaster_deactivated added with B20.)
export const SOCKET_EVENTS = Object.freeze({
  REGISTER:             'register',
  DISASTER_ALERT:       'disaster_alert',
  DISASTER_DEACTIVATED: 'disaster_deactivated',
  STATS_UPDATE:         'stats_update',
  MISSING_ALERT:        'missing_alert',
  INCIDENT_ALERT:       'incident_alert',
  INCIDENT_UPDATE:      'incident_update',
  INCIDENT_RESOLVED:    'incident_resolved',
});

const DEFAULT_LOCATION = { lat: 22.3, lng: 114.1 };

// Polling-first is the Azure App Service-friendly order: HTTP long-polling
// always works, and Socket.IO transparently upgrades to WebSocket when the
// platform allows it. Listing 'websocket' first makes the client attempt a
// direct WS connection that hangs/fails on tiers without WebSocket support.
const socket = io({ autoConnect: true, transports: ['polling', 'websocket'] });

export const isConnected = ref(false);

function registerLocation() {
  const send = (loc) => socket.emit(SOCKET_EVENTS.REGISTER, loc);
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => send({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()    => send(DEFAULT_LOCATION),
      { timeout: 5000 }
    );
  } else {
    send(DEFAULT_LOCATION);
  }
}

socket.on('connect',    () => { isConnected.value = true;  registerLocation(); });
socket.on('disconnect', () => { isConnected.value = false; });

export function useSocket() {
  function onDisasterAlert(cb)       { socket.on(SOCKET_EVENTS.DISASTER_ALERT, cb); return () => socket.off(SOCKET_EVENTS.DISASTER_ALERT, cb); }
  function onDisasterDeactivated(cb) { socket.on(SOCKET_EVENTS.DISASTER_DEACTIVATED, cb); return () => socket.off(SOCKET_EVENTS.DISASTER_DEACTIVATED, cb); }
  function onStatsUpdate(cb)         { socket.on(SOCKET_EVENTS.STATS_UPDATE,   cb); return () => socket.off(SOCKET_EVENTS.STATS_UPDATE,   cb); }
  function onMissingAlert(cb)        { socket.on(SOCKET_EVENTS.MISSING_ALERT,  cb); return () => socket.off(SOCKET_EVENTS.MISSING_ALERT,  cb); }
  function onIncidentAlert(cb)       { socket.on(SOCKET_EVENTS.INCIDENT_ALERT, cb); return () => socket.off(SOCKET_EVENTS.INCIDENT_ALERT, cb); }
  function onIncidentUpdate(cb)      { socket.on(SOCKET_EVENTS.INCIDENT_UPDATE, cb); return () => socket.off(SOCKET_EVENTS.INCIDENT_UPDATE, cb); }
  function onIncidentResolved(cb)    { socket.on(SOCKET_EVENTS.INCIDENT_RESOLVED, cb); return () => socket.off(SOCKET_EVENTS.INCIDENT_RESOLVED, cb); }

  return { socket, isConnected, onDisasterAlert, onDisasterDeactivated, onStatsUpdate, onMissingAlert, onIncidentAlert, onIncidentUpdate, onIncidentResolved };
}

export default socket;
