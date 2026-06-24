import * as SQLite from 'expo-sqlite';
import type { PendingReport } from '../api/apiClient';

/**
 * Local durable outbox backed by Expo SQLite.
 *
 * The never-lose-a-report invariant relies on this: every report is written
 * here before any delivery attempt, and only removed/marked once delivered.
 */

export type OutboxStatus = 'pending' | 'sent' | 'relayed';

export interface OutboxRow {
  id: string;
  payload: PendingReport;
  status: OutboxStatus;
  relay_peer_id: string | null;
  created_at: number;
  updated_at: number;
}

/** Hard cap on outbox rows (C3). Only DELIVERED rows are ever evicted to stay
 *  under it — a pending (undelivered) report is never dropped. */
const MAX_ROWS = 200;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('outbox.db').then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          relay_peer_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

interface RawRow {
  id: string;
  payload: string;
  status: OutboxStatus;
  relay_peer_id: string | null;
  created_at: number;
  updated_at: number;
}

function toRow(raw: RawRow): OutboxRow {
  return {
    id: raw.id,
    payload: JSON.parse(raw.payload) as PendingReport,
    status: raw.status,
    relay_peer_id: raw.relay_peer_id,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

/**
 * Insert a report as pending. Idempotent: a duplicate id is ignored.
 */
export async function enqueue(report: PendingReport): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    await db.runAsync(
      `INSERT OR IGNORE INTO outbox (id, payload, status, relay_peer_id, created_at, updated_at)
       VALUES (?, ?, 'pending', NULL, ?, ?)`,
      [report.id, JSON.stringify(report), report.created_at || now, now]
    );
    // Bound the table: evict the OLDEST delivered rows (sent/relayed) beyond the
    // cap. Pending rows are never touched, so the never-lose invariant holds.
    await db.runAsync(
      `DELETE FROM outbox WHERE id IN (
         SELECT id FROM outbox WHERE status != 'pending' ORDER BY updated_at DESC
         LIMIT -1 OFFSET ?
       )`,
      [MAX_ROWS]
    );
  } catch (err) {
    console.error('[outboxDb.enqueue] failed to enqueue report:', err);
    throw err;
  }
}

/**
 * Return all reports still awaiting delivery.
 */
export async function getPending(): Promise<PendingReport[]> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM outbox WHERE status = 'pending' ORDER BY created_at ASC`
    );
    return rows.map((r) => JSON.parse(r.payload) as PendingReport);
  } catch (err) {
    console.error('[outboxDb.getPending] failed to read pending reports:', err);
    return [];
  }
}

/**
 * Fetch a single report payload by id (or null if absent).
 */
export async function getById(id: string): Promise<PendingReport | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<RawRow>(
      `SELECT * FROM outbox WHERE id = ?`,
      [id]
    );
    return row ? (JSON.parse(row.payload) as PendingReport) : null;
  } catch (err) {
    console.error('[outboxDb.getById] failed to read report:', err);
    return null;
  }
}

/**
 * Mark a report as delivered over the internet.
 */
export async function markSent(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      `UPDATE outbox SET status = 'sent', updated_at = ? WHERE id = ?`,
      [Date.now(), id]
    );
  } catch (err) {
    console.error('[outboxDb.markSent] failed to mark sent:', err);
    throw err;
  }
}

/**
 * Mark a report as relayed via a mesh peer.
 */
export async function markRelayed(id: string, peerId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      `UPDATE outbox SET status = 'relayed', relay_peer_id = ?, updated_at = ? WHERE id = ?`,
      [peerId, Date.now(), id]
    );
  } catch (err) {
    console.error('[outboxDb.markRelayed] failed to mark relayed:', err);
    throw err;
  }
}

/**
 * Return every row (any status) — used for diagnostics / pending counts.
 */
export async function getAll(): Promise<OutboxRow[]> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<RawRow>(
      `SELECT * FROM outbox ORDER BY created_at DESC`
    );
    return rows.map(toRow);
  } catch (err) {
    console.error('[outboxDb.getAll] failed to read outbox:', err);
    return [];
  }
}

export const outboxDb = {
  enqueue,
  getPending,
  getById,
  markSent,
  markRelayed,
  getAll,
};
