import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import type { N10Term } from './fixtures/n10.js';
import { escapeRegExp, sidebarLocator } from './setup/sidebar.js';
import {
  addExternalWorktree,
  cleanupTmuxSessions,
  n10SessionExists,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueTmuxBranch,
} from './setup/tmux.js';

/**
 * A worktree removed without n10 — `git worktree remove`, or its
 * directory deleted — leaves the sidebar on its own. An agent still
 * running there keeps its row and its tab-bar entry, both marked, until
 * it exits or is stopped. Nothing is pressed to notice the removal:
 * noticing is the whole point. Removing a worktree from n10 is
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

/** The removals that go through whatever the agent has written. */
const forcedRemovals: [string, (repoPath: string, dir: string) => void][] = [
  [
    'git worktree remove --force',
    (repoPath, dir) =>
      execFileSync('git', ['worktree', 'remove', '--force', dir], {
        cwd: repoPath,
        stdio: 'ignore',
      }),
  ],
  removals[1]!,
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
  }

  /** A worktree with an agent n10 has attached to, running `command`,
   *  and the locators for its row and its tab-bar entry once marked. */
  async function worktreeWithAgent(
    n10: { repoPath: string; homeDir: string; term: N10Term },
    command: string
  ) {
    const branch = uniqueTmuxBranch();
    branches.push(branch);
    const dir = addExternalWorktree(n10.repoPath, branch);
    startExternalTmuxSession({
      repoPath: n10.repoPath,
      homeDir: n10.homeDir,
      branch,
      worktreePath: dir,
      command,
    });
    const row = sidebarLocator(n10.term.page, branch);
    // The tab bar names a running agent `<digit> <branch>`; the
    // sidebar puts its icon between the two.
    await expect(row.running().first()).toBeVisible({ timeout: 30_000 });
    await expect(n10.term.getByText(`1 ${branch}`).first()).toBeVisible();
    return {
      branch,
      dir,
      row,
      removedTab: n10.term.getByText(`1 ${branch} removed`),
      removedRow: n10.term.page.locator('.term-row', {
        hasText: new RegExp(`${escapeRegExp(branch)} worktree removed`),
      }),
    };
  }

  for (const [how, remove] of forcedRemovals) {
    test(`${how} keeps a running agent's tab, marked, until it is stopped`, async ({
      n10,
    }) => {
      const agent = await worktreeWithAgent(n10, 'sleep 120');

      remove(n10.repoPath, agent.dir);

      await expect(agent.removedTab.first()).toBeVisible({ timeout: 20_000 });
      await expect(agent.removedRow.first()).toBeVisible();
      await expect(agent.row.running().first()).toBeVisible();

      // The only row, so it is the selected one: K stops its agent.
      await n10.term.type('K');

      await expect(agent.row.any()).toHaveCount(0, { timeout: 20_000 });
      await expect(agent.removedTab).toHaveCount(0);
      expect(n10SessionExists(agent.branch, n10.homeDir)).toBe(false);
    });
  }

  test("an agent exiting takes its removed worktree's tab with it", async ({
    n10,
  }) => {
    const agent = await worktreeWithAgent(n10, 'sleep 12');

    forcedRemovals[1]![1](n10.repoPath, agent.dir);

    await expect(agent.removedTab.first()).toBeVisible({ timeout: 20_000 });
    await expect(agent.row.any()).toHaveCount(0, { timeout: 40_000 });
    await expect(agent.removedTab).toHaveCount(0);
  });
});
