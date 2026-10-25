import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    // Plus gating is under test; the free-mode test switches it off.
    env: { PLUS_ENABLED: 'true' },
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One replica set is shared; files run sequentially so collections can be reset between them.
    fileParallelism: false,
  },
});
