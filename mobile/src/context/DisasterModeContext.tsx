import React, { createContext, useContext } from 'react';
import type { Stats, Disaster, IncidentDetail } from '../api/apiClient';
import { ServerConnectionProvider, useServerConnection } from './ServerConnection';
import { DisasterGateProvider, useDisasterGate } from './DisasterGate';
import { IncidentDutyProvider, useIncidentDuty } from './IncidentDuty';
import type { LovedOneAlertItem } from './DisasterGate';

export type { LovedOneAlertItem } from './DisasterGate';

/**
 * Disaster mode is the heart of the mobile = emergency / web = data-collection
 * split. A mobile device is the ONLY device that:
 *   1. registers its location + role so the server can target it,
 *   2. enters "disaster mode" when it is inside an active disaster radius, and
 *   3. is forced to confirm its safety before any other feature is usable.
 *
 * The implementation is split into three focused providers, composed here
 * behind the same single hook:
 *   - ServerConnection — the app's single Socket.IO connection, connectivity
 *     flag, live stats and pending-outbox count.
 *   - DisasterGate — active disasters, acknowledgements, device location and
 *     the disaster-mode gate itself.
 *   - IncidentDuty — CFR responder duty (non-gating incident alerts).
 */

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
  /**
   * True while the device is inside (or server-flagged for) any active disaster
   * zone, regardless of whether the user has already self-reported. Unlike
   * `inDisasterMode` this survives acknowledgement — used to reveal
   * disaster-only features (e.g. the shelters map) after the gate is cleared.
   */
  inDisasterZone: boolean;
  /** Best-known device location (falls back to a HK default). */
  location: { lat: number; lng: number };
  refresh: () => Promise<void>;
  /** Mark a disaster as responded-to, dismissing the gate for it. */
  acknowledgeDisaster: (id: string) => void;
  /**
   * Mark EVERY currently in-zone disaster as responded-to. Reporting your
   * safety is a statement about you, not one disaster — so a single report
   * clears the gate even when overlapping zones stack you into many at once.
   */
  acknowledgeAllInZone: () => void;
  /** In-app alerts for loved ones inside a disaster zone (socket path, open app). */
  lovedOneAlerts: LovedOneAlertItem[];
  dismissLovedOneAlert: (id: string) => void;
  /**
   * CFR: a nearby emergency this opted-in responder has been alerted to (detail
   * + AEDs + co-responder roster). Drives the IncidentResponseScreen. Null when
   * none active. NON-gating — unlike a disaster, it never blocks the app.
   */
  activeIncident: IncidentDetail | null;
  /** Set this responder's status for the active incident. 'declined' dismisses it. */
  /** Open a CFR incident by id (shows the full-screen response screen). */
  openIncident: (id: string) => Promise<void>;
  respondToActiveIncident: (status: 'enroute' | 'onscene' | 'declined') => Promise<void>;
  /** Dismiss the active incident screen without changing status. */
  dismissIncident: () => void;
}

const DisasterModeContext = createContext<DisasterModeValue | null>(null);

/** Reads the three focused providers and republishes the legacy combined value. */
function ComposedValueProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const server = useServerConnection();
  const gate = useDisasterGate();
  const incident = useIncidentDuty();

  const value: DisasterModeValue = {
    stats: server.stats,
    disasters: gate.disasters,
    pending: server.pending,
    loading: server.loading,
    loaded: server.loaded,
    error: server.error,
    connected: server.connected,
    activeDisaster: gate.activeDisaster,
    inDisasterMode: gate.activeDisaster != null,
    inDisasterZone: gate.inDisasterZone,
    location: gate.location,
    refresh: server.refresh,
    acknowledgeDisaster: gate.acknowledgeDisaster,
    acknowledgeAllInZone: gate.acknowledgeAllInZone,
    lovedOneAlerts: gate.lovedOneAlerts,
    dismissLovedOneAlert: gate.dismissLovedOneAlert,
    activeIncident: incident.activeIncident,
    openIncident: incident.openIncident,
    respondToActiveIncident: incident.respondToActiveIncident,
    dismissIncident: incident.dismissIncident,
  };

  return <DisasterModeContext.Provider value={value}>{children}</DisasterModeContext.Provider>;
}

export function DisasterModeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ServerConnectionProvider>
      <DisasterGateProvider>
        <IncidentDutyProvider>
          <ComposedValueProvider>{children}</ComposedValueProvider>
        </IncidentDutyProvider>
      </DisasterGateProvider>
    </ServerConnectionProvider>
  );
}

export function useDisasterMode(): DisasterModeValue {
  const ctx = useContext(DisasterModeContext);
  if (!ctx) throw new Error('useDisasterMode must be used within a DisasterModeProvider');
  return ctx;
}
