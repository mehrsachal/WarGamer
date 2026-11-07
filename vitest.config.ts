import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**/*.ts'],
      exclude: ['packages/engine/src/index.ts'],
      reporter: ['text-summary', 'text'],
      // NFR-09 / Phase 0 gate: engine coverage >= 90 %
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
