import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  sidebarRow,
  tab,
  tabs,
  visibleText,
} from './setup/app.js';
import { listTaggedSessions } from './setup/tmux.js';
import {
  addExternalWorktree,
  startExternalTmuxSession,
} from './setup/external.js';

for (const transition of [
  {
    name: 'rename',
    args: ['branch', '-m', 'renamed'],
    label: 'renamed',
    after: [],
  },
  {
    name: 'checkout',
    args: ['checkout', '-b', 'checked-out'],
    label: 'checked-out',
    after: [],
  },
  {
    name: 'detach HEAD',
    args: ['checkout', '--detach'],
    label: 'transition',
    after: [['branch', '-D', 'transition']],
  },
]) {
  test(`${transition.name} preserves the checkout tab and live agent`, async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'transition');
    await launchAgentFromRail(page);
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();
    const before = listTaggedSessions(homeDir);
    const cwd = join(repoPath, '.claude', 'worktrees', 'transition');
    expect(() =>
      execFileSync('git', ['branch', '-D', 'transition'], {
        cwd,
        stdio: 'pipe',
      })
    ).toThrow();
    execFileSync('git', transition.args, { cwd });
    for (const args of transition.after) execFileSync('git', args, { cwd });
    await expect(sidebarRow(page, new RegExp(transition.label))).toBeVisible({
      timeout: 15_000,
    });
    await expect(tab(page, new RegExp(transition.label))).toBeVisible();
    await expect(tabs(page)).toHaveCount(1);
    expect(listTaggedSessions(homeDir)).toEqual(before);
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();
    execFileSync('git', ['switch', '-c', 'reattached'], { cwd });
    await expect(tab(page, /reattached/)).toBeVisible({ timeout: 15_000 });
    await expect(tabs(page)).toHaveCount(1);
  });
}

test('discovers an external agent on a detached HEAD', async ({ desktop }) => {
  const { page, repoPath, homeDir } = desktop;
  const branch = 'detached-agent';
  const worktreePath = addExternalWorktree(repoPath, branch);
  execFileSync('git', ['checkout', '--detach'], { cwd: worktreePath });
  startExternalTmuxSession({
    repoPath,
    homeDir,
    branch,
    worktreePath,
    command: 'echo detached-agent-ready; sleep 300',
  });
  await expect(sidebarRow(page, /detached-agent/)).toBeVisible({
    timeout: 15_000,
  });
  await sidebarRow(page, /detached-agent/).click();
  test.fail(true, 'https://github.com/notaharness/n10/issues/209');
  await expect(visibleText(page, 'detached-agent-ready')).toBeVisible({
    timeout: 15_000,
  });
});

test('external worktrees respect the configured discovery directory', async ({
  desktop,
}) => {
  const { repoPath, homeDir, page } = desktop;
  const outside = join(homeDir, 'outside');
  execFileSync('git', ['worktree', 'add', '-b', 'outside', outside], {
    cwd: repoPath,
  });
  addExternalWorktree(repoPath, 'owned');
  await expect(sidebarRow(page, /^owned$/)).toBeVisible({ timeout: 15_000 });
  expect(
    execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
      encoding: 'utf8',
    })
  ).toContain(outside);
  await expect(sidebarRow(page, /^outside$/)).toHaveCount(0);
});
