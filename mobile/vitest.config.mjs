import { defineConfig } from 'vitest/config';

// ponytail: pure-logic unit tests only; node env, no RN/global setup.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
