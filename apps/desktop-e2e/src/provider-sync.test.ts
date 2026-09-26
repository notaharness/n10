import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import { updateFakeGh } from './setup/fake-gh.js';

test.use({
  repo: { name: 'sync-demo', worktrees: [{ branch: 'sync-design' }] },
  n10Config: { prPollInterval: 3_600_000 },
  desktopPrefs: { theme: 'dark' },
  fakeGitHub: {
    username: 'tester',
    prs: [
      { number: 42, title: 'Clarify sync status', headRefName: 'sync-design' },
    ],
  },
});

test('automatic PR sync explains its scope and offers an immediate recheck', async ({
  desktop,
}, info) => {
  const { app, page, homeDir } = desktop;
  const status = page.getByRole('button', {
    name: /^GitHub PR sync: Last synced/,
  });
  await expect(status).toBeVisible();
  await expect(sidebarRow(page, /Clarify sync status/)).toBeVisible();
  const before = (await page.evaluate(() => window.n10.getSyncState()))
    .remoteFetches;
  await status.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'GitHub pull request sync' });
  await expect(dialog).toContainText('about every hour');
  await expect(dialog).toContainText(
    'does not push commits or publish draft comments'
  );
  await expect(dialog.locator('time')).toHaveAttribute('datetime', /T/);
  expect(
    (await page.evaluate(() => window.n10.getSyncState())).remoteFetches
  ).toBe(before);
  await page.screenshot({
    path: info.outputPath('sync-details-dark.png'),
    animations: 'disabled',
  });
  updateFakeGh(homeDir, (scenario) => {
    scenario.prs[0].title = 'Fresh from GitHub';
  });
  await app.evaluate(() => {
    process.env.N10_FAKE_GH_LATENCY_MS = '500';
  });
  await dialog
    .getByRole('button', { name: 'Refresh now', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Refreshing…', exact: true })
  ).toBeDisabled();
  await expect(page.locator('footer')).toContainText('Syncing…');
  await expect(
    dialog.getByRole('button', { name: 'Refresh now', exact: true })
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(sidebarRow(page, /Fresh from GitHub/)).toBeVisible();
  expect(
    (await page.evaluate(() => window.n10.getSyncState())).remoteFetches
  ).toBeGreaterThan(before);
  await expect(dialog).toBeHidden();
  await expect(status).toBeFocused();
});

test('failed refresh stays visible, retains good data and recovers on retry', async ({
  desktop,
}, info) => {
  const { page, homeDir } = desktop;
  const status = page.getByRole('button', { name: /^GitHub PR sync:/ });
  await expect(status).toContainText('Last synced');
  await status.click();
  const dialog = page.getByRole('dialog', { name: 'GitHub pull request sync' });
  const lastSuccess = await dialog.locator('time').getAttribute('datetime');
  const binary = join(homeDir, 'fake-bin/gh');
  const healthy = readFileSync(binary);
  // Replace only the fixture executable. No live provider is contacted.
  writeFileSync(
    binary,
    '#!/bin/sh\necho "HTTP 503: offline fixture" >&2\nexit 1\n'
  );
  await dialog
    .getByRole('button', { name: 'Refresh now', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    'GitHub returned an error'
  );
  await expect(dialog.getByRole('alert')).toContainText('may be out of date');
  await expect(dialog.locator('time')).toHaveAttribute(
    'datetime',
    lastSuccess!
  );
  await expect(page.locator('footer')).toContainText('Sync failed');
  await expect(page.locator('aside')).toContainText('Clarify sync status');
  await page.screenshot({
    path: info.outputPath('sync-error-dark.png'),
    animations: 'disabled',
  });
  writeFileSync(binary, healthy);
  await dialog.getByRole('button', { name: 'Retry now', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('footer')).toContainText('Last synced');
  await expect(dialog.locator('time')).not.toHaveAttribute(
    'datetime',
    lastSuccess!
  );
});

test.describe('Azure DevOps status presentation', () => {
  test.use({ desktopPrefs: { theme: 'light' } });
  test('names the provider and makes first-sync failure actionable', async ({
    desktop,
  }, info) => {
    const { app, page } = desktop;
    // Presentation-only Azure state. The host still uses fake GitHub; no ADO account/network.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('n10/sidebar/sync-state');
      ipcMain.handle('n10/sidebar/sync-state', () => ({
        providerId: 'azure-devops',
        providerConfigured: true,
        lastRemoteSyncAt: null,
        lastGitSyncAt: null,
        remoteSyncing: false,
        remoteIntervalMs: 60_000,
        remoteFetches: 1,
        remoteError:
          'Azure DevOps rejected the access token. Update it in Settings.',
      }));
    });
    const status = page.getByRole('button', {
      name: 'Azure DevOps PR sync: Sync failed',
    });
    await expect(status).toBeVisible({ timeout: 10_000 });
    await status.click();
    const dialog = page.getByRole('dialog', {
      name: 'Azure DevOps pull request sync',
    });
    await expect(dialog).toContainText('about every minute');
    await expect(dialog).toContainText('Not synced yet');
    await expect(dialog.getByRole('alert')).toContainText(
      'Update it in Settings'
    );
    await expect(dialog.getByRole('alert')).toContainText('not available yet');
    await expect(
      dialog.getByRole('button', { name: 'Retry now' })
    ).toBeEnabled();
    await page.screenshot({
      path: info.outputPath('sync-error-azure-light.png'),
      animations: 'disabled',
    });
  });
});
