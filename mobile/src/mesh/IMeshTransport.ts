import type { PendingReport } from '../api/apiClient';

/**
 * A peer device discovered over the mesh (BLE advertisement).
 */
export interface Peer {
  id: string;
  /** Signal strength 0-100 (derived from RSSI). Higher = closer/stronger. */
  signalStrength: number;
  /** Whether this peer currently has an internet uplink to forward reports. */
  hasInternet: boolean;
}

/**
 * The contract that any mesh transport (mock or native) must satisfy.
 *
 * A production native module would implement this exact interface so that
 * swapping it in requires changing only the import in syncService.ts.
 */
export interface IMeshTransport {
  /** Scans for nearby peers via BLE. Returns discovered peers. */
  discoverPeers(): Promise<Peer[]>;
  /** Transfers an array of reports to a peer device via WiFi-Direct / Multipeer. */
  sendToPeer(peer: Peer, reports: PendingReport[]): Promise<boolean>;
  /** Register a callback for receiving reports relayed from other peers. */
  onReceive(callback: (reports: PendingReport[], fromPeer: Peer) => void): void;
  /** Stop all radio activity. Call on app background. */
  stop(): void;
}
