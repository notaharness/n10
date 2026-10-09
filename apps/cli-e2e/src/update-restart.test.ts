import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as base, expect, type N10Session } from './fixtures/n10.js';
import { npmUpdateFixture } from '@n10/core/testing/npm-update';
import {
  addExternalWorktree,
  listTaggedSessions,
  startExternalTmuxSession,
  uniqueTmuxBranch,
} from './setup/tmux.js';

function live(n10: N10Session, text: RegExp) {
  return n10.term.root
    .locator('.term-row:not(.term-scrollback-row)')
    .filter({ hasText: text });
}

const test = base.extend<{ npm: Awaited<ReturnType<typeof npmUpdateFixture>> }>(
  {
    npm: async ({ fixtureHome }, provide) => {
      const cli = pathToFileURL(
        resolve(import.meta.dirname, '../../cli/dist/main.js')
      ).href;
      const npm = await npmUpdateFixture(
        fixtureHome,
        `#!/usr/bin/env node\nawait import(${JSON.stringify(cli)});\n`
      );
      await provide(npm);
      await npm.close();
    },
    n10Env: async ({ npm }, provide) => {
      await provide(npm.env);
    },
  }
);
test.use({ cols: 150, rows: 42 });

test('Npm restart: updates in the foreground, reopens the TUI and keeps the same agent', async ({
  n10,
  npm,
}, info) => {
  const branch = uniqueTmuxBranch();
  const worktreePath = addExternalWorktree(n10.repoPath, branch);
  startExternalTmuxSession({
    repoPath: n10.repoPath,
    homeDir: n10.homeDir,
    branch,
    worktreePath,
    command: 'sleep 120',
  });
  const agent = () =>
    listTaggedSessions(n10.homeDir).find(
      (session) => session.branch === branch
    );
  const pid = agent()!.panePid;
  await expect(live(n10, /Update available/)).toBeVisible();
  await n10.term.type('s');
  await expect(live(n10, /Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(live(n10, /Settings › Updates/)).toBeVisible();
  await expect(live(n10, /Update and restart/)).toBeVisible();
  await n10.term.root.screenshot({
    path: info.outputPath('restart-terminal-before.png'),
  });
  await n10.term.type('u');
  await expect
    .poll(
      () =>
        JSON.parse(readFileSync(join(npm.root, 'package.json'), 'utf8')).version
    )
    .toBe(npm.version);
  await expect(live(n10, /Settings › Updates/)).toBeHidden();
  await expect(live(n10, /s settings/)).toBeVisible();
  await n10.term.type('s');
  await expect(live(n10, /Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(live(n10, /Settings › Updates/)).toBeVisible();
  await expect(live(n10, /Current version: 1.0.0-beta.2/)).toBeVisible();
  await expect(live(n10, /Updated to n10 1.0.0-beta.2/)).toBeVisible();
  await expect(live(n10, /Update and restart/)).toBeHidden();
  expect(npm.requests).toContain('/n10.tgz');
  expect(agent()).toMatchObject({ panePid: pid, paneDead: false });
  await n10.term.root.screenshot({
    path: info.outputPath('restart-terminal-after.png'),
  });
});

test('Npm restart: failed npm install reopens with a recovery message and can retry', async ({
  n10,
  npm,
}) => {
  await expect(live(n10, /Update available/)).toBeVisible();
  await n10.term.type('s');
  await expect(live(n10, /Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(live(n10, /Settings › Updates/)).toBeVisible();
  await expect(live(n10, /Update and restart/)).toBeVisible();
  npm.scenario.fail = true;
  await n10.term.type('u');
  await expect
    .poll(() => {
      try {
        return JSON.parse(
          readFileSync(join(n10.homeDir, '.n10/npm-update-result.json'), 'utf8')
        ).status;
      } catch {
        return null;
      }
    })
    .toBe('failed');
  await expect(live(n10, /s settings/)).toBeVisible();
  await n10.term.type('s');
  await expect(live(n10, /Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(live(n10, /Settings › Updates/)).toBeVisible();
  await expect(live(n10, /npm exited 1/)).toBeVisible();
  await expect(live(n10, /Update and restart/)).toBeVisible();
  npm.scenario.fail = false;
  await n10.term.type('u');
  await expect
    .poll(
      () =>
        JSON.parse(
          readFileSync(join(n10.homeDir, '.n10/npm-update-result.json'), 'utf8')
        ).status
    )
    .toBe('succeeded');
  await expect(live(n10, /s settings/)).toBeVisible();
});

test('Npm restart: Ctrl-C during download rolls back, releases the lock and reopens n10', async ({
  n10,
  npm,
}, info) => {
  await expect(live(n10, /Update available/)).toBeVisible();
  await n10.term.type('s');
  await expect(live(n10, /Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(live(n10, /Update and restart/)).toBeVisible();
  npm.scenario.holdTarball = true;
  await n10.term.type('u');
  await expect.poll(() => npm.requests.includes('/n10.tgz')).toBe(true);
  await n10.term.root.screenshot({
    path: info.outputPath('restart-interrupt-pending.png'),
  });
  await n10.term.write('\x03');
  await expect(live(n10, /\^C/)).toBeVisible();
  npm.releaseDownload();
  await expect
    .poll(() => {
      const path = join(n10.homeDir, '.n10/npm-update-result.json');
      return existsSync(path)
        ? JSON.parse(readFileSync(path, 'utf8')).status
        : null;
    })
    .toBe('failed');
  await expect
    .poll(() => existsSync(join(n10.homeDir, '.n10/npm-update.lock')))
    .toBe(false);
  expect(
    JSON.parse(readFileSync(join(npm.root, 'package.json'), 'utf8')).version
  ).toBe('1.0.0-beta.1');
  await expect(live(n10, /s settings/)).toBeVisible();
  await n10.term.type('s');
  await expect(live(n10, /Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(live(n10, /npm exited/)).toBeVisible();
  await expect(live(n10, /npm logs:/)).toBeVisible();
  await n10.term.root.screenshot({
    path: info.outputPath('restart-interrupted.png'),
  });
});
