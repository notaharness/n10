import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureTmux } from './setup/lifecycle.js';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow, tab, tabs, visibleText } from './setup/app.js';
import {
  addExternalWorktree,
  startExternalTmuxSession,
} from './setup/external.js';
import { killFixtureSessions, listTaggedSessions } from './setup/tmux.js';

const endings = [
  {
    name: 'process exit',
    afterExit: (name: string) => [name, 'sentinel'],
    sameServer: true,
    remaining: ['sentinel'],
    stop: (_home: string, path: string) =>
      writeFileSync(join(path, 'finish'), ''),
  },
  {
    name: 'kill session',
    afterExit: () => ['sentinel'],
    sameServer: true,
    remaining: ['sentinel'],
    stop: (home: string, _path: string, name: string) => {
      fixtureTmux(home, 'kill-session', '-t', `=${name}:`);
    },
  },
  {
    name: 'server restart',
    afterExit: () => [],
    sameServer: false,
    remaining: [],
    stop: (home: string) => killFixtureSessions(home),
  },
];

for (const ending of endings) {
  test(`${ending.name} keeps the worktree and discovers its next agent`, async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const branch = 'session-transition';
    const worktreePath = addExternalWorktree(repoPath, branch);
    // A file gate gives the test control over natural process exit without timing races.
    const name = startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath,
      command:
        'echo first-agent-ready; while [ ! -f finish ]; do sleep 0.1; done',
    });
    fixtureTmux(
      homeDir,
      'set-option',
      '-t',
      `=${name}:`,
      'remain-on-exit',
      'on'
    );
    await expect(tab(page, /session-transition/)).toBeVisible({
      timeout: 30_000,
    });
    await tab(page, /session-transition/).click();
    await expect(visibleText(page, 'first-agent-ready')).toBeVisible();
    const serverPid = fixtureTmux(homeDir, 'display-message', '-p', '#{pid}');
    fixtureTmux(
      homeDir,
      'new-session',
      '-d',
      '-s',
      'sentinel',
      '-e',
      `HOME=${homeDir}`,
      'sleep 300'
    );
    ending.stop(homeDir, worktreePath, name);
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() => window.n10.listSessions())
          ).some((s) => s.running),
        { timeout: 15_000 }
      )
      .toBe(false);
    await expect(sidebarRow(page, /session-transition/)).toBeVisible();
    await expect(tabs(page)).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: /Relaunch agent/i })
    ).toBeVisible();
    expect(
      listTaggedSessions(homeDir)
        .map((s) => s.name)
        .sort()
    ).toEqual(ending.afterExit(name).sort());
    // Remove a retained dead pane if present; the sentinel keeps non-restart servers alive.
    for (const session of listTaggedSessions(homeDir).filter(
      (s) => s.name === name
    )) {
      fixtureTmux(homeDir, 'kill-session', '-t', `=${session.name}:`);
    }
    expect(listTaggedSessions(homeDir).map((s) => s.name)).toEqual(
      ending.remaining
    );
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath,
      command: 'echo second-agent-ready; sleep 300',
    });
    expect(
      fixtureTmux(homeDir, 'display-message', '-p', '#{pid}') === serverPid
    ).toBe(ending.sameServer);
    await expect(visibleText(page, 'second-agent-ready')).toBeVisible({
      timeout: 30_000,
    });
    await expect(tabs(page)).toHaveCount(1);
  });
}

test('n10 restart with sessions alive rediscovers the checkout', async ({
  desktop,
}) => {
  const { repoPath, homeDir } = desktop;
  const branch = 'restart-agent';
  const worktreePath = addExternalWorktree(repoPath, branch);
  startExternalTmuxSession({
    repoPath,
    homeDir,
    branch,
    worktreePath,
    command: 'echo restart-agent-ready; sleep 300',
  });
  await expect(tab(desktop.page, /restart-agent/)).toBeVisible({
    timeout: 30_000,
  });
  const before = listTaggedSessions(homeDir);

  await desktop.restart();
  await expect(sidebarRow(desktop.page, /restart-agent/)).toBeVisible();
  await expect(tab(desktop.page, /restart-agent/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(visibleText(desktop.page, 'restart-agent-ready')).toBeVisible();
  expect(listTaggedSessions(homeDir)).toEqual(before);
});

test('n10 restart with sessions gone rediscovers the checkout', async ({
  desktop,
}) => {
  const { repoPath, homeDir } = desktop;
  const branch = 'restart-agent';
  const worktreePath = addExternalWorktree(repoPath, branch);
  startExternalTmuxSession({
    repoPath,
    homeDir,
    branch,
    worktreePath,
    command: 'echo restart-agent-ready; sleep 300',
  });
  await expect(tab(desktop.page, /restart-agent/)).toBeVisible({
    timeout: 30_000,
  });
  killFixtureSessions(homeDir);
  await desktop.restart();
  await expect(sidebarRow(desktop.page, /restart-agent/)).toBeVisible();
  await sidebarRow(desktop.page, /restart-agent/).click();
  await expect(
    desktop.page.getByRole('button', { name: 'Launch agent', exact: true })
  ).toBeVisible();
  expect(listTaggedSessions(homeDir)).toEqual([]);
});
