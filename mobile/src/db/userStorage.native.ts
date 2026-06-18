import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('user_store.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

export const userStorage = {
  get: (key: string): string | null => {
    const row = db.getFirstSync<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [key]);
    return row?.value ?? null;
  },
  set: (key: string, value: string): void => {
    db.runSync(
      `INSERT INTO kv (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  },
  remove: (key: string): void => {
    db.runSync(`DELETE FROM kv WHERE key = ?`, [key]);
  },
};
