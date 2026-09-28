import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';
import { sidebarLocator } from './setup/sidebar.js';
import {
  addExternalWorktree,
  startExternalTmuxSession,
  listTaggedSessions,
} from './setup/tmux.js';

const BRANCH = 'transition';
const MARKER = 'transition-agent-ready';
test.use({
  n10Config: { aiCommand: `echo ${MARKER}; sleep 300`, keybindPreset: 'vim' },
});

for (const transition of [
  {
    name: 'rename',
    before: [],
    args: ['branch', '-m', 'renamed'],
    label: 'renamed',
    after: [],
  },
  {
    name: 'checkout',
    before: [],
    args: ['checkout', '-b', 'checked-out'],
    label: 'checked-out',
    after: [],
  },
  {
    name: 'detach HEAD',
    before: [{ args: ['checkout', '-b', 'pre-detach'], label: 'pre-detach' }],
    args: ['checkout', '--detach'],
    label: BRANCH,
    after: [['branch', '-D', BRANCH, 'pre-detach']],
  },
]) {
  test(`${transition.name} preserves the checkout row and live agent`, async ({
    n10,
  }) => {
    await createSession(n10.term, BRANCH, { start: true });
    await expect(n10.term.getByText(MARKER).first()).toBeVisible();
    const before = listTaggedSessions(n10.homeDir);
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);
    const cwd = join(n10.repoPath, '.claude', 'worktrees', BRANCH);
    expect(() =>
      execFileSync('git', ['branch', '-D', 'transition'], {
        cwd,
        stdio: 'pipe',
      })
    ).toThrow();
    for (const step of transition.before) {
      execFileSync('git', step.args, { cwd });
      await expect(
        sidebarLocator(n10.term.page, step.label)
          .any()
          .and(sidebarLocator(n10.term.page, step.label).running())
      ).toBeVisible({ timeout: 15_000 });
    }
    execFileSync('git', transition.args, { cwd });
    // Delete the now-unused branch in the detached case: the checkout survives.
    for (const args of transition.after) execFileSync('git', args, { cwd });
    await expect(
      sidebarLocator(n10.term.page, transition.label)
        .any()
        .and(sidebarLocator(n10.term.page, transition.label).running())
    ).toBeVisible({ timeout: 15_000 });
    expect(listTaggedSessions(n10.homeDir)).toEqual(before);
    await n10.term.press('Tab');
    await expect(n10.term.getByText(MARKER).first()).toBeVisible();
    execFileSync('git', ['switch', '-c', 'reattached'], { cwd });
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);
    await expect(
      sidebarLocator(n10.term.page, 'reattached').running()
    ).toBeVisible({ timeout: 15_000 });
  });
}

test('discovers an external agent on a detached HEAD', async ({ n10 }) => {
  const { repoPath, homeDir, term } = n10;
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
  await expect(sidebarLocator(term.page, branch).running()).toBeVisible({
    timeout: 30_000,
  });
  await term.press('Tab');
  await expect(term.getByText('detached-agent-ready').first()).toBeVisible();
});

test('external worktrees respect the configured discovery directory', async ({
  n10,
}) => {
  const { repoPath, homeDir, term } = n10;
  const outside = join(homeDir, 'outside');
  execFileSync('git', ['worktree', 'add', '-b', 'outside', outside], {
    cwd: repoPath,
  });
  addExternalWorktree(repoPath, 'owned');
  await expect(sidebarLocator(term.page, 'owned').any()).toBeVisible({
    timeout: 15_000,
  });
  expect(
    execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
      encoding: 'utf8',
    })
  ).toContain(outside);
  await expect(sidebarLocator(term.page, 'outside').any()).toHaveCount(0);
});
