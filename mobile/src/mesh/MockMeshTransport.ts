import type { IMeshTransport, Peer } from './IMeshTransport';
import type { PendingReport } from '../api/apiClient';

/*
 * MOCK IMPLEMENTATION
 *
 * In a production build, this class would be replaced by a native module that:
 *   iOS  — uses CoreBluetooth (BLE advertising/scanning) for discovery,
 *           then MultipeerConnectivity for high-speed data transfer.
 *   Android — uses BluetoothLeAdvertiser + BluetoothLeScanner for discovery,
 *           then WifiP2pManager (WiFi Direct) for transfer.
 *
 * The IMeshTransport interface is the exact contract that native code must satisfy.
 * Swapping MockMeshTransport for a real implementation requires only changing
 * the import in syncService.ts — no other code changes.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockMeshTransport implements IMeshTransport {
  private receiveCallback:
    | ((reports: PendingReport[], fromPeer: Peer) => void)
    | null = null;

  /** Resolves after 500ms with two hardcoded mock peers. */
  async discoverPeers(): Promise<Peer[]> {
    await delay(500);
    return [
      { id: 'peer-alpha', signalStrength: 72, hasInternet: true },
      { id: 'peer-bravo', signalStrength: 45, hasInternet: false },
    ];
  }

  /** Logs the relay action and resolves true after 300ms. */
  async sendToPeer(peer: Peer, reports: PendingReport[]): Promise<boolean> {
    console.log(
      `[MockMeshTransport] relaying ${reports.length} report(s) to peer ${peer.id} ` +
        `(signal ${peer.signalStrength}, internet=${peer.hasInternet})`
    );
    await delay(300);
    return true;
  }

  /** Stores the callback. In the mock it never fires. */
  onReceive(callback: (reports: PendingReport[], fromPeer: Peer) => void): void {
    this.receiveCallback = callback;
  }

  /** No-op in the mock. */
  stop(): void {
    this.receiveCallback = null;
  }
}

/** Shared singleton used by the sync service. */
export const meshTransport: IMeshTransport = new MockMeshTransport();
