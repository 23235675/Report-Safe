import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback,
} from 'react';
import * as Location from 'expo-location';
import { API_BASE_URL, getStats, getDisasters, currentUserId } from '../api/apiClient';
import type { Stats, Disaster } from '../api/apiClient';

export interface LovedOneAlertItem {
  id: string;
  affectedName: string;
  disaster: Disaster;
}
import { outboxDb } from '../db/outboxDb';
import { userStorage } from '../db/userStorage';
import { notificationService } from '../services/notificationService';

/**
 * Disaster mode is the heart of the mobile = emergency / web = data-collection
 * split. A mobile device is the ONLY device that:
 *   1. registers its location + role so the server can target it,
 *   2. enters "disaster mode" when it is inside an active disaster radius, and
 *   3. is forced to confirm its safety before any other feature is usable.
 *
 * This provider owns the app's single Socket.IO connection (so the device is
 * tracked exactly once) and is the single source of truth for live stats,
 * active disasters, and the disaster-mode gate.
 */

const SOCKET_EVENTS = {
  REGISTER:        'register',
  DISASTER_ALERT:  'disaster_alert',
  LOVED_ONE_ALERT: 'loved_one_alert',
  STATS_UPDATE:    'stats_update',
} as const;

const DEFAULT_LOCATION = { lat: 22.3, lng: 114.1 };
const ACK_KEY = 'rs_ack_disasters';

const EMPTY_STATS: Stats = {
  total: 0, safe: 0, injured: 0, need_help: 0,
  awaiting_response: 0, potentially_missing: 0, missing: 0,
  verified_missing: 0, rescued: 0, deceased: 0, active_disasters: 0,
};

interface DisasterModeValue {
  stats: Stats;
  disasters: Disaster[];
  pending: number;
  loading: boolean;
  loaded: boolean;
  error: boolean;
  connected: boolean;
  /** The disaster the user is in-zone for and has not yet responded to. */
  activeDisaster: Disaster | null;
  inDisasterMode: boolean;
  /** Best-known device location (falls back to a HK default). */
  location: { lat: number; lng: number };
  refresh: () => Promise<void>;
  /** Mark a disaster as responded-to, dismissing the gate for it. */
  acknowledgeDisaster: (id: string) => void;
  /** In-app alerts for loved ones inside a disaster zone (socket path, open app). */
  lovedOneAlerts: LovedOneAlertItem[];
  dismissLovedOneAlert: (id: string) => void;
}

const DisasterModeContext = createContext<DisasterModeValue | null>(null);

/** Great-circle distance in km (Haversine) — mirrors server lib/geo.js. */
function withinRadiusKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  radiusKm: number,
): boolean {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)) <= radiusKm;
}

function loadAck(): Set<string> {
  try {
    const raw = userStorage.get(ACK_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function persistAck(set: Set<string>): void {
  try {
    userStorage.set(ACK_KEY, JSON.stringify([...set]));
  } catch {
    /* best-effort */
  }
}

async function resolveLocation(): Promise<{ lat: number; lng: number }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return DEFAULT_LOCATION;
    const pos = await Location.getCurrentPositionAsync({});
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return DEFAULT_LOCATION;
  }
}

export function DisasterModeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [stats, setStats]                 = useState<Stats>(EMPTY_STATS);
  const [disasters, setDisasters]         = useState<Disaster[]>([]);
  const [pending, setPending]             = useState(0);
  const [loading, setLoading]             = useState(true);
  const [loaded, setLoaded]               = useState(false);
  const [error, setError]                 = useState(false);
  const [connected, setConnected]         = useState(false);
  const [activeDisaster, setActiveDisaster] = useState<Disaster | null>(null);
  const [location, setLocation]           = useState(DEFAULT_LOCATION);
  const [lovedOneAlerts, setLovedOneAlerts] = useState<LovedOneAlertItem[]>([]);

  // Refs read inside socket handlers (avoid stale closures).
  const disastersRef    = useRef<Disaster[]>([]);
  const locRef          = useRef(DEFAULT_LOCATION);
  const ackRef          = useRef<Set<string>>(new Set());
  const serverFlaggedRef = useRef<Set<string>>(new Set()); // ids the server alerted us about (⇒ in-zone)
  const loadedRef       = useRef(false);

  /** Recompute the gate from current disasters + location + acknowledgements. */
  const recompute = useCallback(() => {
    const candidates = disastersRef.current.filter((d) =>
      d.active !== false &&
      !ackRef.current.has(d.id) &&
      (serverFlaggedRef.current.has(d.id) || withinRadiusKm(locRef.current, d, d.radius_km)),
    );
    if (candidates.length === 0) {
      setActiveDisaster(null);
      return;
    }
    // Most severe first, then most recently started.
    candidates.sort(
      (a, b) => (b.severity ?? 0) - (a.severity ?? 0) || (b.started_at ?? 0) - (a.started_at ?? 0),
    );
    setActiveDisaster(candidates[0] ?? null);
  }, []);

  const applyDisasters = useCallback((list: Disaster[]) => {
    disastersRef.current = list;
    setDisasters(list);
    recompute();
  }, [recompute]);

  const refresh = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([getStats(), getDisasters()]);
      setStats(s);
      applyDisasters(d);
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
      const all = await outboxDb.getAll();
      setPending(all.filter((r) => r.status === 'pending').length);
    } catch {
      /* ignore */
    }
  }, [applyDisasters]);

  const dismissLovedOneAlert = useCallback((id: string) => {
    setLovedOneAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const acknowledgeDisaster = useCallback((id: string) => {
    ackRef.current.add(id);
    persistAck(ackRef.current);
    recompute();
  }, [recompute]);

  useEffect(() => {
    ackRef.current = loadAck();
    let socket: any = null;
    let mounted = true;

    // Tapping a disaster push (incl. cold-start from a closed app) flags that
    // disaster as in-zone and re-evaluates the gate, so the user lands directly
    // on the safety screen rather than the home tab. A loved_one_alert tap must
    // NOT do this — the recipient isn't in the zone, so it never gates them.
    const offTap = notificationService.addDisasterTapListener((id, type) => {
      if (id && type !== 'loved_one_alert') serverFlaggedRef.current.add(id);
      refresh().then(() => recompute()).catch(() => {});
    });

    (async () => {
      await refresh(); // initial data (uses default location until GPS resolves)

      const loc = await resolveLocation();
      if (!mounted) return;
      locRef.current = loc;
      setLocation(loc);
      recompute(); // re-evaluate the gate now that real location is known

      // Register this device for REMOTE push with its real location, so the
      // server can wake the app with a disaster alert even when it's closed
      // (the socket below only covers the app while it's running). Best-effort.
      notificationService.registerForRemotePush(loc).catch(() => {});

      try {
        const { io } = await import('socket.io-client');
        socket = io(API_BASE_URL, { transports: ['websocket'] });
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
        socket.on(SOCKET_EVENTS.DISASTER_ALERT, (d: Disaster) => {
          // A targeted alert means the server placed us inside this radius.
          serverFlaggedRef.current.add(d.id);
          const next = disastersRef.current.find((x) => x.id === d.id)
            ? disastersRef.current.map((x) => (x.id === d.id ? d : x))
            : [d, ...disastersRef.current];
          applyDisasters(next);
          notificationService.notifyDisaster(d); // fire local OS notification
        });
        // A confirmed loved one is inside an affected zone. Notify ONLY — do not
        // flag a disaster or recompute the gate: the recipient isn't in the zone,
        // so they must never enter disaster mode from this.
        socket.on(
          SOCKET_EVENTS.LOVED_ONE_ALERT,
          (payload: { affectedName?: string; disaster: Disaster }) => {
            if (payload?.disaster) {
              const alertId = `lov-${payload.disaster.id}-${Date.now()}`;
              setLovedOneAlerts((prev) => [
                ...prev,
                { id: alertId, affectedName: payload.affectedName ?? '', disaster: payload.disaster },
              ]);
              notificationService.notifyLovedOne(payload.affectedName || '', payload.disaster);
            }
          },
        );
      } catch (err) {
        console.error('[DisasterModeProvider] socket init failed:', err);
      }
    })();

    return () => {
      mounted = false;
      offTap();
      if (socket) socket.disconnect();
    };
  }, [refresh, recompute, applyDisasters]);

  const value: DisasterModeValue = {
    stats, disasters, pending, loading, loaded, error, connected,
    activeDisaster,
    inDisasterMode: activeDisaster != null,
    location,
    refresh,
    acknowledgeDisaster,
    lovedOneAlerts,
    dismissLovedOneAlert,
  };

  return <DisasterModeContext.Provider value={value}>{children}</DisasterModeContext.Provider>;
}

export function useDisasterMode(): DisasterModeValue {
  const ctx = useContext(DisasterModeContext);
  if (!ctx) throw new Error('useDisasterMode must be used within a DisasterModeProvider');
  return ctx;
}
