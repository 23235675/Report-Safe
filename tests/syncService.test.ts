import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PendingReport } from '../mobile/src/api/apiClient';

/**
 * The mobile sync service depends on Expo-native modules (expo-sqlite, NetInfo)
 * that cannot load under Node. We replace each dependency with an in-memory
 * fake so the 3-layer fallback logic can be tested in isolation.
 */

const mocks = vi.hoisted(() => {
  type Entry = { payload: PendingReport; status: string; relay_peer_id: string | null };
  const store = new Map<string, Entry>();
  const state = { connected: false, peers: [] as Array<{ id: string; signalStrength: number; hasInternet: boolean }> };
  // apiClient.submitReport resolves to { ok, id? }; syncService destructures { ok }.
  const apiSubmit = vi.fn(async (_r: PendingReport) => ({ ok: true }));
  const sendToPeer = vi.fn(async () => true);
  return { store, state, apiSubmit, sendToPeer };
});

vi.mock('../mobile/src/api/apiClient', () => ({
  submitReport: mocks.apiSubmit,
  API_BASE_URL: 'http://localhost:3001',
}));

vi.mock('../mobile/src/db/outboxDb', () => ({
  outboxDb: {
    enqueue: vi.fn(async (r: PendingReport) => {
      if (!mocks.store.has(r.id)) {
        mocks.store.set(r.id, { payload: r, status: 'pending', relay_peer_id: null });
      }
    }),
    getPending: vi.fn(async () =>
      [...mocks.store.values()].filter((e) => e.status === 'pending').map((e) => e.payload)
    ),
    getById: vi.fn(async (id: string) =>
      mocks.store.has(id) ? mocks.store.get(id)!.payload : null
    ),
    markSent: vi.fn(async (id: string) => {
      const e = mocks.store.get(id);
      if (e) e.status = 'sent';
    }),
    markRelayed: vi.fn(async (id: string, peerId: string) => {
      const e = mocks.store.get(id);
      if (e) {
        e.status = 'relayed';
        e.relay_peer_id = peerId;
      }
    }),
    getAll: vi.fn(async () => [...mocks.store.values()]),
  },
}));

vi.mock('../mobile/src/services/connectivityWatcher', () => ({
  connectivityWatcher: {
    isConnected: vi.fn(async () => mocks.state.connected),
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
  },
  isConnected: vi.fn(async () => mocks.state.connected),
}));

vi.mock('../mobile/src/mesh/MockMeshTransport', () => ({
  meshTransport: {
    discoverPeers: vi.fn(async () => mocks.state.peers),
    sendToPeer: mocks.sendToPeer,
    onReceive: vi.fn(),
    stop: vi.fn(),
  },
}));

import { submitReport, attemptDelivery } from '../mobile/src/services/syncService';

function makeReport(id = 'rep-1'): PendingReport {
  return {
    id,
    name: 'Mei Wong',
    status: 'safe',
    lat: 25.03,
    lng: 121.56,
    created_at: Date.now(),
  };
}

beforeEach(() => {
  mocks.store.clear();
  mocks.state.connected = false;
  mocks.state.peers = [];
  mocks.apiSubmit.mockClear();
  mocks.sendToPeer.mockClear();
});

describe('syncService 3-layer fallback', () => {
  it('offline + no peers keeps reports pending in the outbox', async () => {
    const result = await submitReport(makeReport());
    expect(result).toEqual({ delivered: 0, relayed: 0, queued: 1 });
    expect(mocks.store.get('rep-1')!.status).toBe('pending');
    expect(mocks.apiSubmit).not.toHaveBeenCalled();
    expect(mocks.sendToPeer).not.toHaveBeenCalled();
  });

  it('relays via the strongest peer when one is available', async () => {
    mocks.state.peers = [
      { id: 'peer-weak', signalStrength: 30, hasInternet: false },
      { id: 'peer-strong', signalStrength: 88, hasInternet: true },
    ];
    const result = await submitReport(makeReport());

    expect(result.relayed).toBe(1);
    expect(result.delivered).toBe(0);
    expect(mocks.sendToPeer).toHaveBeenCalledTimes(1);
    // The strongest peer must be chosen.
    expect(mocks.sendToPeer.mock.calls[0][0].id).toBe('peer-strong');
    expect(mocks.store.get('rep-1')!.status).toBe('relayed');
    expect(mocks.store.get('rep-1')!.relay_peer_id).toBe('peer-strong');
  });

  it('delivers directly over the internet when online', async () => {
    mocks.state.connected = true;
    const result = await submitReport(makeReport());

    expect(result).toMatchObject({ delivered: 1, relayed: 0, queued: 0 });
    expect(mocks.apiSubmit).toHaveBeenCalledTimes(1);
    expect(mocks.store.get('rep-1')!.status).toBe('sent');
  });

  it('enqueue is idempotent for a duplicate UUID', async () => {
    await submitReport(makeReport('dup'));
    await submitReport(makeReport('dup'));
    expect(mocks.store.size).toBe(1);
  });

  it('attemptDelivery with an empty outbox returns all-zero', async () => {
    const result = await attemptDelivery();
    expect(result).toEqual({ delivered: 0, relayed: 0, queued: 0 });
  });
});
