import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { test, expect } from './fixtures/n10.js';
import { sidebarLocator } from './setup/sidebar.js';
import { addExternalWorktree, uniqueTmuxBranch } from './setup/tmux.js';

/**
 * A worktree removed without n10 — `git worktree remove`, or its
 * directory deleted — leaves the sidebar on its own. Nothing is pressed
 * after the removal: noticing is the whole point. Removing a worktree
 * from n10 is `session-lifecycle.test.ts`.
 */
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
  test.use({ n10Config: { keybindPreset: 'vim' } });

  for (const [how, remove] of removals) {
    test(`${how} drops its row`, async ({ n10 }) => {
      const branch = uniqueTmuxBranch();
      const dir = addExternalWorktree(n10.repoPath, branch);
      const row = sidebarLocator(n10.term.page, branch);
      await expect(row.any().first()).toBeVisible({ timeout: 20_000 });

      remove(n10.repoPath, dir);

      await expect(row.any()).toHaveCount(0, { timeout: 20_000 });
    });
  }
});
