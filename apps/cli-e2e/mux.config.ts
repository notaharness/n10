import { defineConfig } from '@playwright/test';

/**
 * The one-shot mux contract: separate `n10 mux` processes against a
 * foreground owner. No browser and no wterm host, so it runs wherever
 * the CLI builds, Windows included.
 */
export default defineConfig({
  testDir: './src/mux',
  outputDir: './test-output/mux',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
});
