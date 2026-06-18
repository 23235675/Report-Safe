import { defineConfig } from 'vitest/config';

// Root Vitest config.
//  - setupFiles pins every suite to the LOCAL throwaway Postgres and strips any
//    inherited DATABASE_URL so tests can never touch the cloud database.
//  - fileParallelism:false runs suites sequentially; the server suites share one
//    Postgres and DELETE between tests, so they must not run concurrently.
export default defineConfig({
  test: {
    globalSetup: ['./tests/_global.setup.js'],
    setupFiles: ['./tests/_env.setup.js'],
    fileParallelism: false,
    hookTimeout: 30000,
  },
});
