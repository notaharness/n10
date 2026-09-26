import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { sidebarLocator } from './setup/sidebar.js';
import {
  addExternalWorktree,
  cleanupTmuxSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueTmuxBranch,
} from './setup/tmux.js';

/**
 * A worktree removed without n10 — `git worktree remove`, or its
 * directory deleted — leaves the sidebar on its own, and a running
 * agent's entry leaves the tab bar with it. Nothing is pressed after the
 * removal: noticing is the whole point. Removing a worktree from n10 is
 * `session-lifecycle.test.ts`.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

test.use({
  n10Config: {
    aiCommand: fakeAgentCommand({ banner: 'n10-fake-agent-ready' }),
    keybindPreset: 'vim',
  },
});

const removals: [string, (repoPath: string, dir: string) => void][] = [
  [
    'git worktree remove',
    (repoPath, dir) =>
      execFileSync('git', ['worktree', 'remove', dir], {
        cwd: repoPath,
        stdio: 'ignore',
      }),
  ],
  [
    'deleting its directory',
    (_repoPath, dir) => rmSync(dir, { recursive: true, force: true }),
  ],
];

test.describe('A worktree removed outside n10', () => {
  let branches: string[] = [];

  test.beforeEach(() => {
    branches = [];
  });

  // n10's own exit path detaches rather than kills, so an agent left
  // running in a removed worktree would outlive the test.
  test.afterEach(({ n10 }) => {
    cleanupTmuxSessions(branches, n10.homeDir);
  });

  for (const [how, remove] of removals) {
    test(`${how} drops its row`, async ({ n10 }) => {
      const branch = uniqueTmuxBranch();
      branches.push(branch);
      const dir = addExternalWorktree(n10.repoPath, branch);
      const row = sidebarLocator(n10.term.page, branch);
      await expect(row.any().first()).toBeVisible({ timeout: 20_000 });

      remove(n10.repoPath, dir);

      await expect(row.any()).toHaveCount(0, { timeout: 20_000 });
    });

    test(`${how} takes a running agent's tab with its row`, async ({ n10 }) => {
      const branch = uniqueTmuxBranch();
      branches.push(branch);
      const dir = addExternalWorktree(n10.repoPath, branch);
      startExternalTmuxSession({
        repoPath: n10.repoPath,
        homeDir: n10.homeDir,
        branch,
        worktreePath: dir,
        command: 'sleep 120',
      });
      const row = sidebarLocator(n10.term.page, branch);
      // The tab bar names a running agent `<digit> <branch>`; the
      // sidebar puts its icon between the two.
      const tab = n10.term.getByText(`1 ${branch}`);
      await expect(row.running().first()).toBeVisible({ timeout: 30_000 });
      await expect(tab.first()).toBeVisible();

      remove(n10.repoPath, dir);

      await expect(row.any()).toHaveCount(0, { timeout: 20_000 });
      await expect(tab).toHaveCount(0);
    });
  }
});
