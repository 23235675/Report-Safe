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
    // Coverage only runs with `--coverage` (npm run test:coverage / CI). The
    // report is scoped to the server's testable code — db/ (CLI seed/reset
    // scripts) and index.js (bootstrap) are excluded. Thresholds are a floor
    // that fails CI on regression; raise them as coverage improves.
    coverage: {
      provider: 'v8',
      include: ['server/src/**/*.js'],
      exclude: ['server/src/db/**', 'server/src/index.js'],
      reporter: ['text-summary', 'text'],
      // Floor set ~3-4 points below the current server coverage (measured
      // lines 81.9 / functions 80.2 / statements 77.0 / branches 65.5). CI runs
      // with Redis, which covers more than this local no-Redis baseline, so the
      // floor holds with margin. Ratchet these up as any remaining gaps close.
      thresholds: {
        lines: 78,
        functions: 77,
        branches: 62,
        statements: 74,
      },
    },
  },
});
