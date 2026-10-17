import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/desktop.js';
import { fakeUpdateRegistry } from './setup/fake-update-registry.js';
import { clickAppMenuItem } from './setup/menu.js';
import { socketEnv } from './setup/tmux.js';

const test = base.extend<{
  registry: Awaited<ReturnType<typeof fakeUpdateRegistry>>;
}>({
  registry: async ({ fixtureHome }, provide) => {
    // Depend on HOME so the registry stays up for the app's entire lifetime.
    expect(fixtureHome).toContain('n10-desktop-e2e-home-');
    const registry = await fakeUpdateRegistry();
    await provide(registry);
    await registry.close();
  },
  env: async ({ registry }, provide) => {
    await provide({ N10_UPDATE_TEST_REGISTRY: registry.url });
  },
});

test('Updates: notification, command copy, channel persistence and light/dark presentation', async ({
  desktop,
  registry,
}, info) => {
  await desktop.main(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900)
  );
  await clickAppMenuItem(desktop.app, 'Light');
  await expect(
    desktop.page.getByRole('button', { name: 'Update available', exact: true })
  ).toBeVisible();
  await desktop.page.screenshot({
    path: info.outputPath('flow-1-notification.png'),
  });
  await desktop.page
    .getByRole('button', { name: 'Update available', exact: true })
    .click();
  await expect(
    desktop.page.getByText('n10 1.0.0-beta.10 is available', { exact: true })
  ).toBeVisible();
  await desktop.page.screenshot({
    path: info.outputPath('flow-2-settings.png'),
  });
  await desktop.page
    .getByRole('button', { name: 'Appearance', exact: true })
    .click();
  await desktop.page
    .getByRole('button', { name: 'Update available', exact: true })
    .click();
  await expect(
    desktop.page.getByRole('heading', { name: 'Updates', exact: true })
  ).toBeInViewport();
  await desktop.page
    .getByRole('button', { name: 'Copy command', exact: true })
    .click();
  await expect(
    desktop.page.getByRole('button', { name: 'Copied', exact: true })
  ).toBeVisible();
  expect(await desktop.main(({ clipboard }) => clipboard.readText())).toBe(
    'npm i -g @notaharness/n10@1.0.0-beta.10'
  );
  await expect(
    desktop.page.getByText(/n10 doesn’t have a non-beta release yet/)
  ).toHaveCount(0);
  await desktop.page.getByRole('combobox', { name: 'Release channel' }).click();
  await desktop.page.screenshot({
    path: info.outputPath('flow-3-channel.png'),
  });
  await desktop.page
    .getByRole('option', { name: 'Stable', exact: true })
    .click();
  await expect(
    desktop.page.getByRole('combobox', { name: 'Release channel' })
  ).toHaveText('Stable');
  await expect(
    desktop.page.getByText(/n10 doesn’t have a non-beta release yet/)
  ).toBeVisible();
  await desktop.page
    .getByRole('switch', { name: 'Check automatically' })
    .click();
  await expect(
    desktop.page.getByRole('switch', { name: 'Check automatically' })
  ).not.toBeChecked();
  await desktop.page.screenshot({
    path: info.outputPath('flow-4-handoff.png'),
  });
  await desktop.relaunch();
  await desktop.page
    .getByRole('button', { name: 'Update available', exact: true })
    .click();
  await expect(
    desktop.page.getByRole('combobox', { name: 'Release channel' })
  ).toHaveText('Stable');
  expect(
    JSON.parse(
      readFileSync(
        join(desktop.homeDir, '.n10/update-preferences.json'),
        'utf8'
      )
    )
  ).toEqual({ channel: 'stable', automatic: false });
  expect(registry.requests).toHaveLength(1);
  expect(registry.requests[0]?.headers.authorization).toBeUndefined();
  expect(registry.requests[0]?.url).toBe('/dist-tags');
  await desktop.main(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900)
  );
  for (const theme of ['light', 'dark'] as const) {
    await clickAppMenuItem(desktop.app, theme === 'dark' ? 'Dark' : 'Light');
    await expect(desktop.page.locator('html')).toHaveCSS('color-scheme', theme);
    await desktop.page.screenshot({
      path: info.outputPath(`updates-${theme}-1600x900.png`),
    });
  }
});

test('Updates: malformed/offline responses retain the last known version and manual retry recovers', async ({
  desktop,
  registry,
}) => {
  await desktop.page
    .getByRole('button', { name: 'Update available', exact: true })
    .click();
  registry.scenario.body = '{invalid';
  await desktop.page
    .getByRole('button', { name: 'Check now', exact: true })
    .click();
  await expect(
    desktop.page.getByText(/Could not check for updates/)
  ).toBeVisible();
  await expect(
    desktop.page.getByText('n10 1.0.0-beta.10 is available', { exact: true })
  ).toBeVisible();
  registry.scenario.status = 503;
  await desktop.page
    .getByRole('button', { name: 'Check now', exact: true })
    .click();
  await expect.poll(() => registry.requests.length).toBe(3);
  registry.scenario.status = 200;
  registry.scenario.body = JSON.stringify({ beta: '1.0.0-beta.11' });
  await desktop.page
    .getByRole('button', { name: 'Check now', exact: true })
    .click();
  await expect(
    desktop.page.getByText('n10 1.0.0-beta.11 is available', { exact: true })
  ).toBeVisible();
  registry.scenario.status = 429;
  registry.scenario.headers = { 'retry-after': '3600' };
  await desktop.page
    .getByRole('button', { name: 'Check now', exact: true })
    .click();
  await expect(desktop.page.getByText(/rate limited/)).toBeVisible();
  await expect(
    desktop.page.getByRole('button', { name: 'Check now', exact: true })
  ).toBeDisabled();
  await desktop.page.evaluate(() => window.n10.checkUpdates());
  expect(registry.requests).toHaveLength(5);
});

test('Updates: equal and older versions do not offer an update', async ({
  desktop,
  registry,
}) => {
  await desktop.page
    .getByRole('button', { name: 'Update available', exact: true })
    .click();
  for (const version of ['1.0.0-beta.1', '1.0.0-beta.0']) {
    registry.scenario.body = JSON.stringify({ beta: version });
    await desktop.page
      .getByRole('button', { name: 'Check now', exact: true })
      .click();
    await expect(
      desktop.page.getByText('You’re up to date', { exact: true })
    ).toBeVisible();
    await expect(
      desktop.page.getByRole('button', {
        name: 'Update available',
        exact: true,
      })
    ).toHaveCount(0);
    await expect(
      desktop.page.getByRole('button', { name: 'Quit to update', exact: true })
    ).toHaveCount(0);
  }
});

test.describe('Updates: quit handoff', () => {
  test.use({
    liveTerminals: {
      'update-survivor': { cwd: '/tmp', kind: 'agent', command: 'sleep 600' },
    },
  });
  test('Quit to update detaches, and reopening keeps the same agent process', async ({
    desktop,
  }) => {
    const pid = () =>
      execFileSync(
        'tmux',
        ['display-message', '-p', '-t', '=update-survivor:', '#{pane_pid}'],
        { encoding: 'utf8', env: socketEnv(desktop.homeDir) }
      ).trim();
    const before = pid();
    await desktop.page
      .getByRole('button', { name: 'Update available', exact: true })
      .click();
    const closed = desktop.app.waitForEvent('close');
    await desktop.page
      .getByRole('button', { name: 'Quit to update', exact: true })
      .click();
    await closed;
    expect(pid()).toBe(before);
    await desktop.relaunch();
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(
      desktop.page.getByRole('heading', { name: 'Updates', exact: true })
    ).toBeVisible();
    expect(pid()).toBe(before);
  });
});
