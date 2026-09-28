import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetMainBranchCache } from '@n10/worktree-manager';

vi.mock('@n10/logger', () => ({
  log: () => undefined,
  logError: () => undefined,
}));

// The sweep skips a checkout with a live agent; none runs here.
vi.mock('../pty-registry.js', () => ({ isSessionAlive: () => false }));
vi.mock('../session-backend.js', () => ({ hasLiveTmuxSession: () => false }));

import { keyForWorktree } from '../session-key.js';
import { sweepMergedBranches, syncRemote } from './remote-sync.js';

/**
 * `syncRemote(repo)` and `sweepMergedBranches({ cwd })` against real
 * repositories sharing a local bare remote. The desktop switches repositories by changing the process's
 * directory, so a sync that started for one repository may finish with
 * the process in another: every step must act on the repository it was
 * given.
 */

const originalCwd = process.cwd();
let root: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

/** A repository with one commit on `branch`, configured to commit. */
function init(dir: string, branch: string): void {
  git(root, 'init', '-q', '-b', branch, dir);
  configure(dir);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'base');
}

function configure(dir: string): void {
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
}

function commit(dir: string, message: string): string {
  writeFileSync(join(dir, `${message}.txt`), message);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/** A bare remote seeded from a repository on `branch`, and a clone of
 *  it checked out on another branch so main is free to move. */
function remoteWithClone(name: string, branch: string) {
  const seed = join(root, `${name}-seed`);
  const remote = join(root, `${name}.git`);
  const clone = join(root, name);
  init(seed, branch);
  git(root, 'init', '-q', '--bare', '-b', branch, remote);
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', 'origin', branch);
  git(root, 'clone', '-q', remote, clone);
  configure(clone);
  git(clone, 'switch', '-q', '-c', 'feature');
  return { seed, clone };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'n10-remote-sync-'));
  // A step that ignores its repository then lands in a fixture, never
  // in the checkout running the tests.
  process.chdir(root);
  resetMainBranchCache();
});

afterEach(() => {
  process.chdir(originalCwd);
  resetMainBranchCache();
  rmSync(root, { recursive: true, force: true });
});

describe('syncRemote', () => {
  it('fast-forwards the repository it was given, not the one in the process directory', async () => {
    const a = remoteWithClone('a', 'main');
    const b = remoteWithClone('b', 'main');
    git(a.clone, 'switch', '-q', 'main');
    const unpushed = commit(a.clone, 'unpushed');
    git(a.clone, 'switch', '-q', '-c', 'elsewhere', 'origin/main');
    const pushed = commit(b.seed, 'pushed');
    git(b.seed, 'push', '-q', 'origin', 'main');
    process.chdir(a.clone);

    await syncRemote(b.clone);

    expect(git(a.clone, 'rev-parse', 'main')).toBe(unpushed);
    expect(git(b.clone, 'rev-parse', 'main')).toBe(pushed);
  });

  it('detects each repository’s own main branch', async () => {
    const a = remoteWithClone('a', 'main');
    const b = remoteWithClone('b', 'master');
    await syncRemote(a.clone);
    const pushed = commit(b.seed, 'pushed');
    git(b.seed, 'push', '-q', 'origin', 'master');
    process.chdir(a.clone);

    await syncRemote(b.clone);

    expect(git(b.clone, 'rev-parse', 'master')).toBe(pushed);
  });

  it('never moves a diverged main off commits origin does not have', async () => {
    const b = remoteWithClone('b', 'main');
    git(b.clone, 'switch', '-q', 'main');
    const unpushed = commit(b.clone, 'unpushed');
    git(b.clone, 'switch', '-q', 'feature');
    commit(b.seed, 'pushed');
    git(b.seed, 'push', '-q', 'origin', 'main');
    process.chdir(b.clone);

    await syncRemote(b.clone);

    expect(git(b.clone, 'rev-parse', 'main')).toBe(unpushed);
  });

  it('leaves a repository without a local main without one', async () => {
    const b = remoteWithClone('b', 'main');
    git(b.clone, 'branch', '-q', '-D', 'main');
    commit(b.seed, 'pushed');
    git(b.seed, 'push', '-q', 'origin', 'main');
    process.chdir(b.clone);

    await syncRemote(b.clone);

    expect(git(b.clone, 'branch', '--list', 'main')).toBe('');
  });
});

describe('sweepMergedBranches', () => {
  /** A repository with a `feature` checkout under the default worktree
   *  directory; `dirty` leaves an uncommitted file in it. */
  function repoWithFeature(name: string, dirty: boolean) {
    const repo = join(root, name);
    init(repo, 'main');
    const checkout = join(repo, '.claude', 'worktrees', 'feature');
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', checkout);
    if (dirty) writeFileSync(join(checkout, 'uncommitted.txt'), 'work');
    return { repo: realpathSync(repo), checkout: realpathSync(checkout) };
  }

  /** Sweep `repo` with `feature` reported merged at its tip and
   *  auto-delete on, and return what it asked to delete. */
  async function sweep(repo: string): Promise<[string, string][]> {
    const deleted: [string, string][] = [];
    const head = git(repo, 'rev-parse', 'feature');
    await sweepMergedBranches({
      provider: {
        fetchMergedBranches: () =>
          Promise.resolve(new Map([['feature', [head]]])),
      } as never,
      vcsConfigured: true,
      config: { vendorAuth: {}, vendorProject: {}, autoDeleteOnMerge: true },
      branches: ['feature'],
      warnedRebase: new Set(),
      onAutoDelete: (sessionName, branch) => {
        deleted.push([sessionName, branch]);
      },
      onRebaseInProgress: () => undefined,
      cwd: repo,
    });
    return deleted;
  }

  it('refuses to delete a branch whose checkout in the given repository has work', async () => {
    const a = repoWithFeature('a', false);
    const b = repoWithFeature('b', true);
    process.chdir(a.repo);

    expect(await sweep(b.repo)).toEqual([]);
  });

  it('names the given repository’s checkout when it deletes', async () => {
    const a = repoWithFeature('a', true);
    const b = repoWithFeature('b', false);
    process.chdir(a.repo);

    expect(await sweep(b.repo)).toEqual([
      [keyForWorktree({ path: b.checkout }, b.repo), 'feature'],
    ]);
  });
});
