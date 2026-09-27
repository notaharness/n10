import { execFileSync } from 'node:child_process';
import { realpathSync, renameSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { sidebarLocator } from './setup/sidebar.js';
import {
  addExternalWorktree,
  listTaggedSessions,
  startExternalTmuxSession,
  type TaggedTmuxSession,
} from './setup/tmux.js';

test.use({ n10Config: { keybindPreset: 'vim' } });

const paths = [
  {
    name: 'symlink',
    prepare: (repo: string, next: string) => symlinkSync(repo, next, 'dir'),
    restore: (_repo: string, next: string) => rmSync(next, { force: true }),
    // The same physical checkout: its tags already name it.
    tags: (before: TaggedTmuxSession[]) => before,
  },
  {
    name: 'moved',
    prepare: moveRepo,
    restore: (repo: string, next: string) => moveRepo(next, repo),
    // Rebound to the checkout the agent moved with.
    tags: (before: TaggedTmuxSession[], next: string) =>
      before.map((s) => ({
        ...s,
        repo: realpathSync(next),
        worktreePath: realpathSync(
          join(next, '.claude', 'worktrees', 'path-agent')
        ),
      })),
  },
];

function moveRepo(from: string, to: string): void {
  renameSync(from, to);
  execFileSync(
    'git',
    ['worktree', 'repair', join(to, '.claude', 'worktrees', 'path-agent')],
    { cwd: to }
  );
}

for (const pathKind of paths) {
  test(`opening a ${pathKind.name} repo preserves its checkout and agent`, async ({
    n10,
  }) => {
    const { repoPath, homeDir, term } = n10;
    const branch = 'path-agent';
    const worktreePath = addExternalWorktree(repoPath, branch);
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath,
      command: 'echo path-agent-ready; sleep 300',
    });
    const row = sidebarLocator(term.page, branch);
    await expect(row.running()).toBeVisible({ timeout: 30_000 });
    const before = listTaggedSessions(homeDir);
    const names = () => listTaggedSessions(homeDir).map((s) => s.name);
    const nextPath = join(homeDir, 'repo');
    try {
      pathKind.prepare(repoPath, nextPath);
      await n10.restart(nextPath);
      await expect(row.any()).toBeVisible();
      expect(names()).toEqual(before.map((s) => s.name));
      await expect(row.running()).toBeVisible({ timeout: 15_000 });
      await term.press('Tab');
      await expect(term.getByText('path-agent-ready').first()).toBeVisible();
      expect(listTaggedSessions(homeDir)).toEqual(
        pathKind.tags(before, nextPath)
      );
    } finally {
      try {
        await n10.stop();
      } finally {
        pathKind.restore(repoPath, nextPath);
      }
    }
  });
}
