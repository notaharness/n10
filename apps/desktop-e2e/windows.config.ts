import { defineConfig } from '@playwright/test';

/**
 * The Windows viability suites (`nx e2e:windows desktop-e2e`): the
 * session host's lifetime under real Electron and the mux pipe against
 * another local account. They drive their own probe processes, not the
 * built desktop app, so this target does not depend on `desktop:build`.
 */
const outputBase = './test-output/windows';

export default defineConfig({
  testDir: './src/windows',
  outputDir: `${outputBase}/output`,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: `${outputBase}/report` }],
      ]
    : 'list',
});
