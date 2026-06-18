import * as apiClient from '../api/apiClient';
import type { PendingReport } from '../api/apiClient';
import { outboxDb } from '../db/outboxDb';
import { meshTransport } from '../mesh/MockMeshTransport';
import { connectivityWatcher } from './connectivityWatcher';

/**
 * 3-layer resilient delivery:
 *   1. Direct internet (apiClient)
 *   2. Mesh relay to the strongest nearby peer
 *   3. Stay queued locally until a path appears
 */

export interface DeliveryResult {
  delivered: number;
  relayed: number;
  queued: number;
  /** Permanently rejected by the server (4xx) — removed from the queue, not retried. */
  rejected?: number;
  /** The server's reason for a permanent rejection (shown to the user). */
  error?: string;
}

/**
 * Submit a report. Always persists to the local outbox first, then attempts
 * delivery through the available layers.
 */
export async function submitReport(report: PendingReport): Promise<DeliveryResult> {
  try {
    // Layer 0: durable local write — never lose a report.
    await outboxDb.enqueue(report);
    return attemptDelivery(report.id);
  } catch (err) {
    console.error('[syncService.submitReport] failed to submit report:', err);
    return { delivered: 0, relayed: 0, queued: 1 };
  }
}

/**
 * Attempt to deliver one report (by id) or the whole pending queue.
 */
export async function attemptDelivery(reportId?: string): Promise<DeliveryResult> {
  try {
    let pending: PendingReport[];
    if (reportId) {
      const one = await outboxDb.getById(reportId);
      pending = one ? [one] : [];
    } else {
      pending = await outboxDb.getPending();
    }

    if (pending.length === 0) {
      return { delivered: 0, relayed: 0, queued: 0 };
    }

    // Layer 1: Direct internet.
    if (await connectivityWatcher.isConnected()) {
      let delivered = 0;
      let rejected = 0;
      let lastError: string | undefined;
      for (const report of pending) {
        const { ok, status, error } = await apiClient.submitReport(report);
        if (ok) {
          await outboxDb.markSent(report.id);
          delivered++;
        } else if (status && status >= 400 && status < 500) {
          // PERMANENT rejection (bad data) — drop it so it doesn't clog the
          // queue forever; surface the real reason. Mirrors the web outbox.
          await outboxDb.markSent(report.id);
          rejected++;
          lastError = error;
        }
        // else: transient (offline/5xx) → leave queued for the next attempt.
      }
      return { delivered, relayed: 0, queued: pending.length - delivered - rejected, rejected, error: lastError };
    }

    // Layer 2: Mesh relay.
    const peers = await meshTransport.discoverPeers();
    if (peers.length > 0) {
      const bestPeer = [...peers].sort(
        (a, b) => b.signalStrength - a.signalStrength
      )[0]!;
      let relayed = 0;
      for (const report of pending) {
        const ok = await meshTransport.sendToPeer(bestPeer, [report]);
        if (ok) {
          await outboxDb.markRelayed(report.id, bestPeer.id);
          relayed++;
        }
      }
      return { delivered: 0, relayed, queued: pending.length - relayed };
    }

    // Layer 3: Stay queued.
    return { delivered: 0, relayed: 0, queued: pending.length };
  } catch (err) {
    console.error('[syncService.attemptDelivery] delivery attempt failed:', err);
    return { delivered: 0, relayed: 0, queued: reportId ? 1 : 0 };
  }
}
