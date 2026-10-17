import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { agentCommentRepository } from './agent-comment-scope.js';

it('uses the same finding identity for a root and linked worktree', () => {
  const home = mkdtempSync(join(tmpdir(), 'n10-finding-scope-'));
  const root = join(home, 'repo'),
    linked = join(home, 'linked');
  const git = (args: string[], cwd = home) =>
    execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    });
  try {
    git(['init', root]);
    git(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'fixture',
      ],
      root
    );
    git(['worktree', 'add', '-b', 'linked', linked], root);
    expect(agentCommentRepository(linked)).toBe(agentCommentRepository(root));
    expect(agentCommentRepository(root)).toBe(join(root, '.git'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
