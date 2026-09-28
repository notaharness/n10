import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { settleFor } from './setup/waits.js';
import { sidebarLocator } from './setup/sidebar.js';
import { fixtureTmux } from './setup/lifecycle.js';
import {
  addExternalWorktree,
  killFixtureSessions,
  listTaggedSessions,
  startExternalTmuxSession,
} from './setup/tmux.js';

test.use({ n10Config: { keybindPreset: 'vim' } });

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
  test(`${ending.name} keeps the row and discovers its next agent`, async ({
    n10,
  }) => {
    const { repoPath, homeDir, term } = n10;
    const branch = 'session-transition';
    const worktreePath = addExternalWorktree(repoPath, branch);
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
    const row = sidebarLocator(term.page, branch);
    await expect(row.running()).toBeVisible({ timeout: 30_000 });
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
    await expect(row.running()).toHaveCount(0, { timeout: 15_000 });
    await expect(row.any()).toBeVisible();
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
    await expect(row.running()).toBeVisible({ timeout: 30_000 });
    await term.press('Tab');
    await expect(term.getByText('second-agent-ready').first()).toBeVisible();
  });
}

test('n10 restart with sessions alive rediscovers the checkout', async ({
  n10,
}) => {
  const { repoPath, homeDir, term } = n10;
  const branch = 'restart-agent';
  const worktreePath = addExternalWorktree(repoPath, branch);
  startExternalTmuxSession({
    repoPath,
    homeDir,
    branch,
    worktreePath,
    command: 'echo restart-agent-ready; sleep 300',
  });
  const row = sidebarLocator(term.page, branch);
  await expect(row.running()).toBeVisible({ timeout: 30_000 });
  const before = listTaggedSessions(homeDir);

  await n10.restart();
  await expect(row.any()).toBeVisible();
  await expect(row.running()).toBeVisible({ timeout: 30_000 });
  expect(listTaggedSessions(homeDir)).toEqual(before);
  await term.press('Tab');
  await expect(term.getByText('restart-agent-ready').first()).toBeVisible();
});

test('n10 restart with sessions gone rediscovers the checkout', async ({
  n10,
}) => {
  const { repoPath, homeDir, term } = n10;
  const branch = 'restart-agent';
  const worktreePath = addExternalWorktree(repoPath, branch);
  startExternalTmuxSession({
    repoPath,
    homeDir,
    branch,
    worktreePath,
    command: 'echo restart-agent-ready; sleep 300',
  });
  const row = sidebarLocator(term.page, branch);
  await expect(row.running()).toBeVisible({ timeout: 30_000 });
  killFixtureSessions(homeDir);
  await n10.restart();
  await expect(row.any()).toBeVisible();
  await settleFor(
    term.page,
    5_000,
    'one four-second discovery interval after restart before asserting no automatic launch'
  );
  await expect(row.running()).toHaveCount(0);
  expect(listTaggedSessions(homeDir)).toEqual([]);
});
