import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback,
} from 'react';
import type { Disaster } from '../api/apiClient';
import { severityRank } from '../utils/severity';
import { resolveLocation, DEFAULT_LOCATION } from '../utils/location';
import { userStorage } from '../db/userStorage';
import { notificationService } from '../services/notificationService';
import { useServerConnection, SOCKET_EVENTS, DISASTERS_REFRESHED } from './ServerConnection';

/**
 * Owns the disaster-mode gate: the active disaster list, per-disaster
 * acknowledgements, the device location, and the in-zone computation that
 * decides whether the app is locked behind the safety screen. Also owns the
 * in-app loved-one alerts (they ride the same disaster payloads but must never
 * gate the recipient).
 *
 * Drives the boot sequence: initial refresh → resolve real location →
 * re-evaluate the gate → register for remote push → open the socket (via
 * ServerConnection) with the real location.
 */

const ACK_KEY = 'rs_ack_disasters';

export interface LovedOneAlertItem {
  id: string;
  affectedName: string;
  disaster: Disaster;
}

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

export interface DisasterGateValue {
  disasters: Disaster[];
  /** The disaster the user is in-zone for and has not yet responded to. */
  activeDisaster: Disaster | null;
  inDisasterZone: boolean;
  /** Best-known device location (falls back to a HK default). */
  location: { lat: number; lng: number };
  /** Live ref to the same location — for callbacks that must never read stale coordinates. */
  locationRef: React.MutableRefObject<{ lat: number; lng: number }>;
  acknowledgeDisaster: (id: string) => void;
  acknowledgeAllInZone: () => void;
  lovedOneAlerts: LovedOneAlertItem[];
  dismissLovedOneAlert: (id: string) => void;
}

const DisasterGateContext = createContext<DisasterGateValue | null>(null);

export function DisasterGateProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { refresh, subscribe, startSocket } = useServerConnection();

  const [disasters, setDisasters]           = useState<Disaster[]>([]);
  const [activeDisaster, setActiveDisaster] = useState<Disaster | null>(null);
  const [inDisasterZone, setInDisasterZone] = useState(false);
  const [location, setLocation]             = useState(DEFAULT_LOCATION);
  const [lovedOneAlerts, setLovedOneAlerts] = useState<LovedOneAlertItem[]>([]);

  // Refs read inside socket handlers (avoid stale closures).
  const disastersRef     = useRef<Disaster[]>([]);
  const locRef           = useRef(DEFAULT_LOCATION);
  const ackRef           = useRef<Set<string>>(new Set());
  const serverFlaggedRef = useRef<Set<string>>(new Set()); // ids the server alerted us about (⇒ in-zone)

  /** Recompute the gate from current disasters + location + acknowledgements. */
  const recompute = useCallback(() => {
    // In-zone for an active disaster, ignoring acknowledgement — drives
    // disaster-only features that should stay available after self-reporting.
    setInDisasterZone(disastersRef.current.some((d) =>
      d.active !== false &&
      (serverFlaggedRef.current.has(d.id) || withinRadiusKm(locRef.current, d, d.radius_km)),
    ));
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
      (a, b) => severityRank(b.severity) - severityRank(a.severity) || (b.started_at ?? 0) - (a.started_at ?? 0),
    );
    setActiveDisaster(candidates[0] ?? null);
  }, []);

  const applyDisasters = useCallback((list: Disaster[]) => {
    disastersRef.current = list;
    setDisasters(list);
    recompute();
  }, [recompute]);

  const dismissLovedOneAlert = useCallback((id: string) => {
    setLovedOneAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const acknowledgeDisaster = useCallback((id: string) => {
    ackRef.current.add(id);
    persistAck(ackRef.current);
    recompute();
  }, [recompute]);

  const acknowledgeAllInZone = useCallback(() => {
    for (const d of disastersRef.current) {
      if (
        d.active !== false &&
        (serverFlaggedRef.current.has(d.id) || withinRadiusKm(locRef.current, d, d.radius_km))
      ) {
        ackRef.current.add(d.id);
      }
    }
    persistAck(ackRef.current);
    recompute();
  }, [recompute]);

  useEffect(() => {
    ackRef.current = loadAck();
    let mounted = true;

    // Tapping a disaster push (incl. cold-start from a closed app) flags that
    // disaster as in-zone and re-evaluates the gate, so the user lands directly
    // on the safety screen rather than the home tab. A loved_one_alert tap must
    // NOT do this — the recipient isn't in the zone, so it never gates them.
    const offTap = notificationService.addDisasterTapListener((id, type) => {
      if (id && type !== 'loved_one_alert') serverFlaggedRef.current.add(id);
      refresh().then(() => recompute()).catch(() => {});
    });

    // refresh() fetched a full disaster list — apply it and re-evaluate the gate.
    const offRefreshed = subscribe(DISASTERS_REFRESHED, (list: Disaster[]) => applyDisasters(list));

    const offAlert = subscribe(SOCKET_EVENTS.DISASTER_ALERT, (d: Disaster) => {
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
    const offLoved = subscribe(
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

      // Open the socket with the real location (ServerConnection emits REGISTER).
      startSocket(loc);
    })();

    return () => {
      mounted = false;
      offTap();
      offRefreshed();
      offAlert();
      offLoved();
    };
  }, [refresh, recompute, applyDisasters, subscribe, startSocket]);

  const value: DisasterGateValue = {
    disasters,
    activeDisaster,
    inDisasterZone,
    location,
    locationRef: locRef,
    acknowledgeDisaster,
    acknowledgeAllInZone,
    lovedOneAlerts,
    dismissLovedOneAlert,
  };

  return <DisasterGateContext.Provider value={value}>{children}</DisasterGateContext.Provider>;
}

export function useDisasterGate(): DisasterGateValue {
  const ctx = useContext(DisasterGateContext);
  if (!ctx) throw new Error('useDisasterGate must be used within a DisasterGateProvider');
  return ctx;
}
