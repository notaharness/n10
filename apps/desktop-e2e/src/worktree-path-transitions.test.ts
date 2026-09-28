import { execFileSync } from 'node:child_process';
import { renameSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { visibleWithin } from './setup/lifecycle.js';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow, tab, tabs, visibleText } from './setup/app.js';
import {
  addExternalWorktree,
  startExternalTmuxSession,
} from './setup/external.js';
import { listTaggedSessions } from './setup/tmux.js';

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
    desktop,
  }) => {
    const { repoPath, homeDir } = desktop;
    const branch = 'path-agent';
    const worktreePath = addExternalWorktree(repoPath, branch);
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath,
      command: 'echo path-agent-ready; sleep 300',
    });
    await expect(tab(desktop.page, /path-agent/)).toBeVisible({
      timeout: 30_000,
    });
    const before = listTaggedSessions(homeDir);
    const nextPath = join(homeDir, 'repo');
    let observed = false;
    try {
      pathKind.prepare(repoPath, nextPath);
      await desktop.restart(nextPath);
      await expect(sidebarRow(desktop.page, /path-agent/)).toBeVisible();
      await sidebarRow(desktop.page, /path-agent/).click();
      expect(listTaggedSessions(homeDir)).toEqual(before);
      observed = await visibleWithin(
        visibleText(desktop.page, 'path-agent-ready')
      );
      await expect(tabs(desktop.page)).toHaveCount(1);
      expect(listTaggedSessions(homeDir)).toEqual(before);
    } finally {
      // Stop and restore before the expected-failure annotation: cleanup errors must fail CI.
      try {
        await desktop.stop();
      } finally {
        pathKind.restore(repoPath, nextPath);
      }
    }
    test.fail(
      pathKind.name === 'moved',
      'https://github.com/notaharness/n10/issues/208'
    );
    expect(observed).toBe(true);
  });
}
