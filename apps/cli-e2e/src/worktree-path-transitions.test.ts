import { execFileSync } from 'node:child_process';
import { renameSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { sidebarLocator } from './setup/sidebar.js';
import { restartN10 } from './setup/lifecycle.js';
import {
  addExternalWorktree,
  listTaggedSessions,
  startExternalTmuxSession,
} from './setup/tmux.js';

test.use({ n10Config: { keybindPreset: 'vim' } });

const paths = [
  {
    name: 'symlink',
    prepare: (repo: string, next: string) => symlinkSync(repo, next, 'dir'),
    restore: (_repo: string, next: string) => rmSync(next, { force: true }),
  },
  {
    name: 'moved',
    prepare: moveRepo,
    restore: (repo: string, next: string) => moveRepo(next, repo),
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
    const nextPath = join(homeDir, 'repo');
    try {
      pathKind.prepare(repoPath, nextPath);
      await restartN10(n10, nextPath);
      await expect(row.any()).toBeVisible();
      expect(listTaggedSessions(homeDir)).toEqual(before);
      test.fail(
        pathKind.name === 'moved',
        'https://github.com/notaharness/n10/issues/208'
      );
      await expect(row.running()).toBeVisible({ timeout: 15_000 });
      expect(listTaggedSessions(homeDir)).toEqual(before);
      await term.press('Tab');
      await expect(term.getByText('path-agent-ready').first()).toBeVisible();
    } finally {
      pathKind.restore(repoPath, nextPath);
    }
  });
}
