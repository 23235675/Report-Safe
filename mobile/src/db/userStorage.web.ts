export const userStorage = {
  get: (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set: (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch {}
  },
  remove: (key: string): void => {
    try { localStorage.removeItem(key); } catch {}
  },
};
