import { io } from 'socket.io-client';
import { ref } from 'vue';

export const SOCKET_EVENTS = Object.freeze({
  REGISTER:       'register',
  DISASTER_ALERT: 'disaster_alert',
  STATS_UPDATE:   'stats_update',
  REPORT_UPDATE:  'report_update',
  MISSING_ALERT:  'missing_alert',
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
  function onDisasterAlert(cb)  { socket.on(SOCKET_EVENTS.DISASTER_ALERT, cb); return () => socket.off(SOCKET_EVENTS.DISASTER_ALERT, cb); }
  function onStatsUpdate(cb)    { socket.on(SOCKET_EVENTS.STATS_UPDATE,   cb); return () => socket.off(SOCKET_EVENTS.STATS_UPDATE,   cb); }
  function onReportUpdate(cb)   { socket.on(SOCKET_EVENTS.REPORT_UPDATE,  cb); return () => socket.off(SOCKET_EVENTS.REPORT_UPDATE,  cb); }
  function onMissingAlert(cb)   { socket.on(SOCKET_EVENTS.MISSING_ALERT,  cb); return () => socket.off(SOCKET_EVENTS.MISSING_ALERT,  cb); }

  return { socket, isConnected, onDisasterAlert, onStatsUpdate, onReportUpdate, onMissingAlert };
}

export default socket;
