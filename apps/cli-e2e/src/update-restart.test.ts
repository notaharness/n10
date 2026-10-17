import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test as base, expect, type N10Session } from './fixtures/n10.js';
import { npmUpdateFixture } from '@n10/core/testing/npm-update';
import { settleFor } from './setup/waits.js';
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

const cancelling = [
  /Cancelling update…/,
  /Waiting for the current download to finish, then restoring the previous version\. Keep n10 open\./,
];

/** Hold the download, start Update and restart, and wait for npm to fetch. */
async function startHeldUpdate(n10: N10Session, npm: Npm) {
  await expect(live(n10, /Update available/)).toBeVisible();
  await n10.term.type('s');
  await expect(live(n10, /Updates — version/)).toBeVisible();
  await n10.term.type('u');
  await expect(live(n10, /Update and restart/)).toBeVisible();
  npm.scenario.holdTarball = true;
  await n10.term.type('u');
  await expect.poll(() => npm.requests.includes('/n10.tgz')).toBe(true);
}

/** npm retires the old package directory before it extracts the new one, so
 * mid-install there is briefly no manifest to read. */
function installedVersion(npm: Npm) {
  const path = join(npm.root, 'package.json');
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version
    : null;
}

function updateStatus(n10: N10Session) {
  const path = join(n10.homeDir, '.n10/npm-update-result.json');
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { status: string }).status
    : null;
}

/** npm is the child of the lock's owner, the n10 process running it. */
function npmPid(n10: N10Session) {
  const [owner] = readdirSync(join(n10.homeDir, '.n10/npm-update.lock'));
  return Number(execFileSync('pgrep', ['-P', owner]).toString().trim());
}

type Npm = Awaited<ReturnType<typeof npmUpdateFixture>>;
const test = base.extend<{ npm: Npm }>({
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
});
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
  await expect.poll(() => installedVersion(npm)).toBe(npm.version);
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
  await startHeldUpdate(n10, npm);
  await n10.term.root.screenshot({
    path: info.outputPath('restart-interrupt-pending.png'),
  });
  await n10.term.write('\x03');
  for (const text of cancelling) await expect(live(n10, text)).toBeVisible();
  await n10.term.root.screenshot({
    path: info.outputPath('restart-cancelling.png'),
  });
  npm.releaseDownload();
  await expect.poll(() => updateStatus(n10)).toBe('failed');
  await expect
    .poll(() => existsSync(join(n10.homeDir, '.n10/npm-update.lock')))
    .toBe(false);
  expect(installedVersion(npm)).toBe('1.0.0-beta.1');
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

test('Npm restart: a second Ctrl-C while cancelling is ignored and npm still rolls back', async ({
  n10,
  npm,
}) => {
  await startHeldUpdate(n10, npm);
  await n10.term.write('\x03');
  for (const text of cancelling) await expect(live(n10, text)).toBeVisible();
  const pid = npmPid(n10);
  await n10.term.write('\x03');
  await settleFor(
    n10.term.page,
    1000,
    'a forwarded second SIGINT would kill npm before its rollback'
  );
  expect(() => process.kill(pid, 0)).not.toThrow();
  await expect(live(n10, cancelling[0])).toHaveCount(1);
  npm.releaseDownload();
  await expect.poll(() => updateStatus(n10)).toBe('failed');
  expect(existsSync(join(npm.root, 'main.js'))).toBe(true);
  expect(installedVersion(npm)).toBe('1.0.0-beta.1');
  await expect(live(n10, /s settings/)).toBeVisible();
});

test('Npm restart: npm killed mid-install leaves the pinned recovery command last when the entry is gone', async ({
  n10,
  npm,
}, info) => {
  await startHeldUpdate(n10, npm);
  process.kill(npmPid(n10), 'SIGKILL');
  const command = 'Run npm i -g @notaharness/n10@1.0.0-beta.2, then n10 --tui.';
  await expect
    .poll(async () => {
      const rows = await n10.term.root
        .locator('.term-row:not(.term-scrollback-row)')
        .allTextContents();
      return rows
        .map((row) => row.trim())
        .filter(Boolean)
        .at(-1);
    })
    .toBe(command);
  expect(existsSync(join(npm.root, 'main.js'))).toBe(false);
  expect(existsSync(join(n10.homeDir, '.n10/npm-update.lock'))).toBe(false);
  expect(updateStatus(n10)).toBe('failed');
  await expect(n10.term.getByText(/MODULE_NOT_FOUND/)).toHaveCount(0);
  await n10.term.root.screenshot({
    path: info.outputPath('restart-killed.png'),
  });
});
