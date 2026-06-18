import * as SQLite from 'expo-sqlite';

export interface WatchlistEntry {
  name:     string;
  added_at: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('watchlist.db').then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS watchlist (
          name     TEXT PRIMARY KEY,
          added_at INTEGER NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function add(name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR IGNORE INTO watchlist (name, added_at) VALUES (?, ?)`,
    [name, Date.now()]
  );
}

export async function remove(name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM watchlist WHERE name = ?`, [name]);
}

export async function getAll(): Promise<WatchlistEntry[]> {
  const db = await getDb();
  return db.getAllAsync<WatchlistEntry>(
    `SELECT name, added_at FROM watchlist ORDER BY added_at DESC`
  );
}

export async function has(name: string): Promise<boolean> {
  const db  = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM watchlist WHERE name = ?`,
    [name]
  );
  return (row?.n ?? 0) > 0;
}

export const watchlistDb = { add, remove, getAll, has };
