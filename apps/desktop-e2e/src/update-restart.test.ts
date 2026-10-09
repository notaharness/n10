import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/desktop.js';
import { npmUpdateFixture } from './setup/fake-npm-install.js';
import { npmUpdateParent } from './setup/npm-update-parent.js';
import { clickAppMenuItem } from './setup/menu.js';
import { socketEnv } from './setup/tmux.js';

const test = base.extend<{
  npm: Awaited<ReturnType<typeof npmUpdateFixture>>;
  parent: Awaited<ReturnType<typeof npmUpdateParent>>;
}>({
  npm: async ({ fixtureHome }, provide) => {
    // A tiny fixture release records that the installed entry point ran.
    const marker = join(fixtureHome, 'restarted.json');
    const entry = `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(
      marker
    )}, JSON.stringify(process.argv));\n`;
    const npm = await npmUpdateFixture(fixtureHome, entry);
    await provide(npm);
    await npm.close();
  },
  parent: async ({ npm }, provide) => {
    const parent = await npmUpdateParent(npm.root, npm.env);
    await provide(parent);
    await parent.close();
  },
  env: async ({ npm, parent }, provide) => {
    await provide({ ...npm.env, N10_UPDATE_HANDOFF: parent.request });
  },
});
test.use({
  liveTerminals: {
    'restart-survivor': { cwd: '/tmp', kind: 'agent', command: 'sleep 600' },
  },
});

test('Npm restart: desktop quits, npm installs the pinned release, and the replacement entry runs', async ({
  desktop,
  npm,
  parent,
}, info) => {
  const pid = () =>
    execFileSync(
      'tmux',
      ['display-message', '-p', '-t', '=restart-survivor:', '#{pane_pid}'],
      { encoding: 'utf8', env: socketEnv(desktop.homeDir) }
    ).trim();
  const before = pid();
  await desktop.main(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900)
  );
  await desktop.page
    .getByRole('button', { name: 'Update available', exact: true })
    .click();
  const update = desktop.page.getByRole('button', {
    name: 'Update and restart',
    exact: true,
  });
  await expect(update).toBeVisible();
  for (const theme of ['Light', 'Dark']) {
    await clickAppMenuItem(desktop.app, theme);
    await desktop.page.screenshot({
      path: info.outputPath(`restart-${theme.toLowerCase()}-1600x900.png`),
    });
  }
  const child = desktop.app.process();
  const closed = desktop.app.waitForEvent('close');
  await update.click();
  await closed;
  expect(child.exitCode).toBe(42);
  expect(npm.requests).not.toContain('/n10.tgz');
  await parent.finish(42);
  expect(npm.requests).toContain('/n10.tgz');
  expect(
    JSON.parse(readFileSync(join(npm.root, 'package.json'), 'utf8')).version
  ).toBe(npm.version);
  expect(
    JSON.parse(readFileSync(join(desktop.homeDir, 'restarted.json'), 'utf8'))[1]
  ).toBe(join(npm.root, 'main.js'));
  expect(pid()).toBe(before);
  // Drive the real desktop again against the updated fixture installation.
  await desktop.relaunch();
  await clickAppMenuItem(desktop.app, 'Settings…');
  await expect(
    desktop.page.getByText('Updated to n10 1.0.0-beta.2.', { exact: true })
  ).toBeVisible();
  await expect(
    desktop.page.getByRole('button', {
      name: 'Update and restart',
      exact: true,
    })
  ).toHaveCount(0);
  await desktop.main(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 900)
  );
  await desktop.page.screenshot({
    path: info.outputPath('restart-complete-1600x900.png'),
  });
  expect(pid()).toBe(before);
});
