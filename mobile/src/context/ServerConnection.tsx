import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback,
} from 'react';
import { API_BASE_URL, getStats, getDisasters, currentUserId } from '../api/apiClient';
import type { Stats } from '../api/apiClient';
import { outboxDb } from '../db/outboxDb';

/**
 * Owns the app's single Socket.IO connection (so the device is tracked exactly
 * once) plus everything that comes straight off the wire: the connected flag,
 * live stats, the pending-outbox count, and the initial stats/disasters fetch.
 *
 * Other providers hook into socket traffic through a small subscribe(event,
 * handler) seam instead of touching the socket directly — the socket stays a
 * private implementation detail of this provider.
 */

export const SOCKET_EVENTS = {
  REGISTER:          'register',
  DISASTER_ALERT:    'disaster_alert',
  LOVED_ONE_ALERT:   'loved_one_alert',
  STATS_UPDATE:      'stats_update',
  INCIDENT_ALERT:    'incident_alert',
  INCIDENT_UPDATE:   'incident_update',
  INCIDENT_RESOLVED: 'incident_resolved',
} as const;

/**
 * Internal (non-socket) event fired through the same seam whenever refresh()
 * fetches a fresh disaster list — DisasterGate subscribes to apply it.
 */
export const DISASTERS_REFRESHED = 'disasters_refreshed';

const EMPTY_STATS: Stats = {
  total: 0, safe: 0, injured: 0, need_help: 0,
  awaiting_response: 0, potentially_missing: 0, missing: 0,
  verified_missing: 0, rescued: 0, deceased: 0, active_disasters: 0,
};

type SeamHandler = (payload: any) => void;

export interface ServerConnectionValue {
  stats: Stats;
  pending: number;
  loading: boolean;
  loaded: boolean;
  error: boolean;
  connected: boolean;
  /** Re-fetch stats + disasters (+ pending count). Disasters are delivered to subscribers of DISASTERS_REFRESHED. */
  refresh: () => Promise<void>;
  /** Register a handler for a socket event (or DISASTERS_REFRESHED). Returns an unsubscribe function. */
  subscribe: (event: string, handler: SeamHandler) => () => void;
  /**
   * Create the socket once the device's real location is known (the REGISTER
   * emit must carry it so the server can radius-target this device). Called by
   * DisasterGate at the end of its boot sequence.
   */
  startSocket: (loc: { lat: number; lng: number }) => void;
}

const ServerConnectionContext = createContext<ServerConnectionValue | null>(null);

export function ServerConnectionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [stats, setStats]         = useState<Stats>(EMPTY_STATS);
  const [pending, setPending]     = useState(0);
  const [loading, setLoading]     = useState(true);
  const [loaded, setLoaded]       = useState(false);
  const [error, setError]         = useState(false);
  const [connected, setConnected] = useState(false);

  const loadedRef   = useRef(false);
  const socketRef   = useRef<any>(null);
  const disposedRef = useRef(false);
  const handlersRef = useRef<Map<string, Set<SeamHandler>>>(new Map());

  const subscribe = useCallback((event: string, handler: SeamHandler) => {
    const existing = handlersRef.current.get(event);
    const set = existing ?? new Set<SeamHandler>();
    if (!existing) handlersRef.current.set(event, set);
    set.add(handler);
    return () => { set.delete(handler); };
  }, []);

  const dispatch = useCallback((event: string, payload: any) => {
    const set = handlersRef.current.get(event);
    if (set) for (const handler of set) handler(payload);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([getStats(), getDisasters()]);
      setStats(s);
      dispatch(DISASTERS_REFRESHED, d);
      setError(false);
      loadedRef.current = true;
      setLoaded(true);
    } catch {
      if (!loadedRef.current) setError(true);
    } finally {
      setLoading(false);
    }
    // Pending count is non-critical — never let SQLite block the UI.
    try {
      const pendingReports = await outboxDb.getPending();
      setPending(pendingReports.length);
    } catch {
      /* ignore */
    }
  }, [dispatch]);

  const startSocket = useCallback((loc: { lat: number; lng: number }) => {
    if (disposedRef.current || socketRef.current) return;
    (async () => {
      try {
        const { io } = await import('socket.io-client');
        if (disposedRef.current || socketRef.current) return;
        const socket = io(API_BASE_URL, { transports: ['websocket'] });
        socketRef.current = socket;
        socket.on('connect', () => {
          setConnected(true);
          // Identify as a mobile device (so the server targets disaster alerts
          // here) AND by user id (so a loved_one_alert can reach this open app
          // when one of our confirmed links is in a zone).
          socket.emit(SOCKET_EVENTS.REGISTER, {
            lat: loc.lat,
            lng: loc.lng,
            userType: 'mobile',
            userId: currentUserId(),
          });
        });
        socket.on('disconnect', () => setConnected(false));
        socket.on(SOCKET_EVENTS.STATS_UPDATE, (s: Stats) => setStats(s));
        // Everything else fans out to the other providers through the seam.
        socket.on(SOCKET_EVENTS.DISASTER_ALERT, (payload: any) => dispatch(SOCKET_EVENTS.DISASTER_ALERT, payload));
        socket.on(SOCKET_EVENTS.LOVED_ONE_ALERT, (payload: any) => dispatch(SOCKET_EVENTS.LOVED_ONE_ALERT, payload));
        socket.on(SOCKET_EVENTS.INCIDENT_ALERT, (payload: any) => dispatch(SOCKET_EVENTS.INCIDENT_ALERT, payload));
        socket.on(SOCKET_EVENTS.INCIDENT_UPDATE, (payload: any) => dispatch(SOCKET_EVENTS.INCIDENT_UPDATE, payload));
        socket.on(SOCKET_EVENTS.INCIDENT_RESOLVED, (payload: any) => dispatch(SOCKET_EVENTS.INCIDENT_RESOLVED, payload));
      } catch (err) {
        console.error('[DisasterModeProvider] socket init failed:', err);
      }
    })();
  }, [dispatch]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []);

  const value: ServerConnectionValue = {
    stats, pending, loading, loaded, error, connected,
    refresh, subscribe, startSocket,
  };

  return <ServerConnectionContext.Provider value={value}>{children}</ServerConnectionContext.Provider>;
}

export function useServerConnection(): ServerConnectionValue {
  const ctx = useContext(ServerConnectionContext);
  if (!ctx) throw new Error('useServerConnection must be used within a ServerConnectionProvider');
  return ctx;
}
