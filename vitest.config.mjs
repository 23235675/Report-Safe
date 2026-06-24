import { defineConfig } from 'vitest/config';

// Root Vitest config.
//  - setupFiles pins every suite to the LOCAL throwaway MongoDB (+ optional
//    Redis) and forces an isolated test DB so tests can never touch the cloud
//    Cosmos/MongoDB configured in server/.env.
//  - fileParallelism:false runs suites sequentially; the server suites share one
//    MongoDB and DELETE between tests, so they must not run concurrently.
export default defineConfig({
  test: {
    globalSetup: ['./tests/_global.setup.js'],
    setupFiles: ['./tests/_env.setup.js'],
    fileParallelism: false,
    hookTimeout: 30000,
  },
});
