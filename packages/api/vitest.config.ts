import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/test/setup.ts'],
    // Integration tests share one DB; run serially to avoid cross-test races.
    fileParallelism: false,
  },
});
