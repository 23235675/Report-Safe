// Type declaration for the platform-resolved userStorage module.
//
// At bundle time Metro picks userStorage.native.ts (device) or userStorage.web.ts
// (web) based on the platform extension. TypeScript's `tsc` does not understand
// those platform extensions, so this co-located .d.ts gives it the shared type
// for the bare `../db/userStorage` import. Keep in sync with both impls.
export declare const userStorage: {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};
