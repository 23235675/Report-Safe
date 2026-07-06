import React, {
  createContext, useContext, useEffect, useState, useCallback,
} from 'react';
import { currentUserId, getIncident, respondToIncident } from '../api/apiClient';
import type { IncidentDetail, IncidentResponder } from '../api/apiClient';
import { notificationService } from '../services/notificationService';
import { translateStandalone } from '../i18n';
import { useServerConnection, SOCKET_EVENTS } from './ServerConnection';
import { useDisasterGate } from './DisasterGate';

/**
 * CFR (Community First Responder) duty state: a nearby emergency this opted-in
 * responder has been alerted to (detail + AEDs + co-responder roster). Drives
 * the IncidentResponseScreen. NON-gating — unlike a disaster, it never blocks
 * the app.
 */

export interface IncidentDutyValue {
  activeIncident: IncidentDetail | null;
  /** Open a CFR incident by id (shows the full-screen response screen). */
  openIncident: (id: string) => Promise<void>;
  /** Set this responder's status for the active incident. 'declined' dismisses it. */
  respondToActiveIncident: (status: 'enroute' | 'onscene' | 'declined') => Promise<void>;
  /** Dismiss the active incident screen without changing status. */
  dismissIncident: () => void;
}

const IncidentDutyContext = createContext<IncidentDutyValue | null>(null);

export function IncidentDutyProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { subscribe } = useServerConnection();
  const { locationRef } = useDisasterGate();

  const [activeIncident, setActiveIncident] = useState<IncidentDetail | null>(null);

  /** Fetch full incident detail (incident + AEDs + roster) and open the screen. */
  const openIncident = useCallback(async (id: string) => {
    try {
      const detail = await getIncident(id);
      if (detail?.incident?.status === 'active') setActiveIncident(detail);
    } catch {
      /* not a responder for this incident, or it's gone — ignore */
    }
  }, []);

  const dismissIncident = useCallback(() => setActiveIncident(null), []);

  const respondToActiveIncident = useCallback(
    async (status: 'enroute' | 'onscene' | 'declined') => {
      const current = activeIncident;
      if (!current) return;
      try {
        await respondToIncident(current.incident.id, {
          status,
          lat: locationRef.current.lat,
          lng: locationRef.current.lng,
        });
      } catch {
        /* best-effort — still update the UI below */
      }
      if (status === 'declined') { setActiveIncident(null); return; }
      // Reflect my own status in the local roster immediately.
      const uid = currentUserId();
      setActiveIncident((prev) => {
        if (!prev) return prev;
        const mine: IncidentResponder = {
          user_id: uid || 'me', name: translateStandalone('incident.you'), status,
          eta_seconds: null, lat: locationRef.current.lat, lng: locationRef.current.lng, updated_at: Date.now(),
        };
        const others = prev.responders.filter((r) => r.user_id !== uid);
        return { ...prev, responders: [mine, ...others] };
      });
    },
    [activeIncident, locationRef],
  );

  useEffect(() => {
    // Tapping a responder push (incl. cold start) opens that incident's screen.
    const offIncidentTap = notificationService.addIncidentTapListener((id) => {
      openIncident(id).catch(() => {});
    });

    // CFR: a nearby emergency this responder was matched to. Fetch detail
    // (AEDs + roster) and open the screen + fire a local alert. NON-gating.
    const offAlert = subscribe(SOCKET_EVENTS.INCIDENT_ALERT, (incident: { id: string } & Record<string, any>) => {
      if (!incident?.id) return;
      notificationService.notifyIncident(incident as any);
      openIncident(incident.id).catch(() => {});
    });

    // A co-responder changed status/position — merge into the open roster.
    const offUpdate = subscribe(SOCKET_EVENTS.INCIDENT_UPDATE, (payload: { incidentId: string; response: IncidentResponder }) => {
      setActiveIncident((prev) => {
        if (!prev || !payload?.response || prev.incident.id !== payload.incidentId) return prev;
        const others = prev.responders.filter((r) => r.user_id !== payload.response.user_id);
        return { ...prev, responders: [...others, payload.response] };
      });
    });

    // The incident was resolved/stood down — close the screen.
    const offResolved = subscribe(SOCKET_EVENTS.INCIDENT_RESOLVED, (payload: { id: string }) => {
      setActiveIncident((prev) => (prev && prev.incident.id === payload?.id ? null : prev));
    });

    return () => {
      offIncidentTap();
      offAlert();
      offUpdate();
      offResolved();
    };
  }, [subscribe, openIncident]);

  const value: IncidentDutyValue = {
    activeIncident,
    openIncident,
    respondToActiveIncident,
    dismissIncident,
  };

  return <IncidentDutyContext.Provider value={value}>{children}</IncidentDutyContext.Provider>;
}

export function useIncidentDuty(): IncidentDutyValue {
  const ctx = useContext(IncidentDutyContext);
  if (!ctx) throw new Error('useIncidentDuty must be used within an IncidentDutyProvider');
  return ctx;
}
