import type { Machine } from './machine.js';
/**
 * Integration tests for worktree functions.
 * These run real git commands against throwaway repos in temp directories.
 * No mocks — exercises actual git behavior.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createWorktree,
  removeWorktree,
  rebaseOntoMaster,
} from './worktree.js';
import { canRemoveBranch } from './removal-check.js';
import { listWorktrees } from './worktree-list.js';
import { worktreeScope } from './worktree-resolver.js';
import {
  listBranches,
  listAllBranches,
  fastForwardMainBranch,
  countConflicts,
  resetMainBranchCache,
} from './branches.js';

// Collect temp dirs for cleanup
const tempDirs: string[] = [];
let originalCwd: string;

function setupGitRepo(): { repoDir: string } {
  const repoDir = mkdtempSync(join(tmpdir(), 'worktree-test-'));
  tempDirs.push(repoDir);

  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', {
    cwd: repoDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Test User"', {
    cwd: repoDir,
    stdio: 'pipe',
  });
  execSync('git commit --allow-empty -m "initial commit"', {
    cwd: repoDir,
    stdio: 'pipe',
  });

  return { repoDir };
}

/**
 * Set up a bare "remote" repo and a clone that points to it as origin.
 * Returns { remoteDir, cloneDir }.
 */
function setupRemoteAndClone(): {
  remoteDir: string;
  cloneDir: string;
} {
  // Create bare remote
  const remoteDir = mkdtempSync(join(tmpdir(), 'worktree-remote-'));
  tempDirs.push(remoteDir);
  execSync('git init --bare', { cwd: remoteDir, stdio: 'pipe' });

  // Create a working repo, add remote, push initial commit
  const seedDir = mkdtempSync(join(tmpdir(), 'worktree-seed-'));
  tempDirs.push(seedDir);
  execSync('git init', { cwd: seedDir, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', {
    cwd: seedDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Test User"', {
    cwd: seedDir,
    stdio: 'pipe',
  });
  // Use 'master' branch explicitly
  execSync('git checkout -b master', { cwd: seedDir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "initial commit"', {
    cwd: seedDir,
    stdio: 'pipe',
  });
  execSync(`git remote add origin "${remoteDir}"`, {
    cwd: seedDir,
    stdio: 'pipe',
  });
  execSync('git push -u origin master', { cwd: seedDir, stdio: 'pipe' });

  // Clone from the bare remote
  const cloneDir = mkdtempSync(join(tmpdir(), 'worktree-clone-'));
  tempDirs.push(cloneDir);
  execSync(`git clone "${remoteDir}" "${cloneDir}"`, { stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Test User"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  return { remoteDir, cloneDir };
}

beforeEach(() => {
  originalCwd = process.cwd();
  resetMainBranchCache();
  template = undefined;
});

afterEach(() => {
  process.chdir(originalCwd);
});

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
});

describe('integration: listBranches', () => {
  it('should list real branches', async () => {
    const { repoDir } = setupGitRepo();
    process.chdir(repoDir);

    execSync('git checkout -b feature-a', { stdio: 'pipe' });
    execSync('git checkout -b feature-b', { stdio: 'pipe' });

    const branches = await listBranches(process.cwd());
    expect(branches).toContain('feature-a');
    expect(branches).toContain('feature-b');
  });
});

describe('integration: createWorktree / removeWorktree', () => {
  it('should create a worktree directory and remove it', async () => {
    const { repoDir } = setupGitRepo();
    process.chdir(repoDir);

    execSync('git checkout -b test-wt', { stdio: 'pipe' });
    execSync('git checkout -', { stdio: 'pipe' }); // back to default branch

    const path = await createWorktree('test-wt', scope());
    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);

    const removed = await removeWorktree('test-wt', scope(), {});
    expect(removed).toBe(true);
    expect(existsSync(path!)).toBe(false);
  });

  it('should create a new branch when branch does not exist', async () => {
    const { repoDir } = setupGitRepo();
    process.chdir(repoDir);

    const path = await createWorktree('brand-new-branch', scope());
    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);

    // Verify branch was created
    const branches = await listBranches(process.cwd());
    expect(branches).toContain('brand-new-branch');

    await removeWorktree('brand-new-branch', scope(), {});
  });
});

describe('integration: a worktree deleted from disk', () => {
  it('is not listed, and its branch checks out again', async () => {
    const { repoDir } = setupGitRepo();
    process.chdir(repoDir);

    const path = await createWorktree('ghost', scope());
    expect(path).not.toBeNull();
    rmSync(path!, { recursive: true, force: true });

    expect((await listWorktrees(scope())).map((w) => w.branch)).not.toContain(
      'ghost'
    );
    // git still has it registered, which would refuse `worktree add`
    // for the branch and the directory alike.
    expect(await createWorktree('ghost', scope())).toBe(path);
    expect(existsSync(path!)).toBe(true);
    expect((await listWorktrees(scope())).map((w) => w.branch)).toContain(
      'ghost'
    );

    await removeWorktree('ghost', scope(), {});
  });
});

describe('integration: canRemoveBranch', () => {
  it('should detect uncommitted changes in worktree', async () => {
    const { repoDir } = setupGitRepo();
    process.chdir(repoDir);

    const path = await createWorktree('dirty-branch', scope());
    expect(path).not.toBeNull();

    // Create a dirty file in the worktree
    writeFileSync(join(path!, 'dirty.txt'), 'uncommitted content');

    const result = await canRemoveBranch('dirty-branch', scope(), {});
    expect(result).toEqual({ safe: false, reason: 'uncommitted changes' });

    await removeWorktree('dirty-branch', scope(), {});
  });

  it('should allow removal of clean branch that is pushed', async () => {
    const { cloneDir } = setupRemoteAndClone();
    process.chdir(cloneDir);

    // Create branch, push it to remote, then create worktree
    execSync('git checkout -b clean-branch', { stdio: 'pipe' });
    execSync('git push -u origin clean-branch', { stdio: 'pipe' });
    execSync('git checkout master', { stdio: 'pipe' });

    const path = await createWorktree('clean-branch', scope());
    expect(path).not.toBeNull();

    const result = await canRemoveBranch('clean-branch', scope(), {});
    expect(result).toEqual({ safe: true });

    await removeWorktree('clean-branch', scope(), {});
  });
  // Named, the repository is where every check looks, even for a
  // branch with no checkout there: a dirty checkout of the same branch
  // in the process's repository is not this repository's.
  it('checks the repository it is given, not the process directory', async () => {
    const { repoDir: here } = setupGitRepo();
    const { repoDir: there } = setupGitRepo();
    process.chdir(here);
    const path = await createWorktree('shared', scope());
    writeFileSync(join(path!, 'dirty.txt'), 'uncommitted content');
    execSync('git branch shared', { cwd: there, stdio: 'pipe' });

    expect(
      await canRemoveBranch('shared', scope(there), { confirmedMerged: true })
    ).toEqual({
      safe: true,
    });

    await removeWorktree('shared', scope(), { force: true });
  });
});

describe('integration: listAllBranches', () => {
  it('should list local branches in a repo without remotes', async () => {
    const { repoDir } = setupGitRepo();
    process.chdir(repoDir);

    execSync('git checkout -b alpha', { stdio: 'pipe' });
    execSync('git checkout -b beta', { stdio: 'pipe' });

    const branches = await listAllBranches();
    expect(branches).toContain('alpha');
    expect(branches).toContain('beta');
  });

  it('should deduplicate remote branches', async () => {
    const { cloneDir } = setupRemoteAndClone();
    process.chdir(cloneDir);

    // 'master' exists both locally and as origin/master
    const branches = await listAllBranches();
    const masterCount = branches.filter((b) => b === 'master').length;
    expect(masterCount).toBe(1);
  });
});

describe('integration: fastForwardMainBranch', () => {
  it('should fast-forward local master to match remote', async () => {
    const { remoteDir, cloneDir } = setupRemoteAndClone();
    process.chdir(cloneDir);

    // Add a commit to the remote via a separate working copy
    const pushDir = mkdtempSync(join(tmpdir(), 'worktree-push-'));
    tempDirs.push(pushDir);
    execSync(`git clone "${remoteDir}" "${pushDir}"`, { stdio: 'pipe' });
    execSync('git config user.email "other@example.com"', {
      cwd: pushDir,
      stdio: 'pipe',
    });
    execSync('git config user.name "Other User"', {
      cwd: pushDir,
      stdio: 'pipe',
    });
    writeFileSync(join(pushDir, 'new-file.txt'), 'content');
    execSync('git add .', { cwd: pushDir, stdio: 'pipe' });
    execSync('git commit -m "remote commit"', {
      cwd: pushDir,
      stdio: 'pipe',
    });
    execSync('git push', { cwd: pushDir, stdio: 'pipe' });

    // Off master, the update is a local fetch rather than a merge.
    execSync('git checkout -b temp-branch', { cwd: cloneDir, stdio: 'pipe' });

    // Record local master before fast-forward
    const localBefore = execSync('git rev-parse master', {
      cwd: cloneDir,
      encoding: 'utf8',
    }).trim();

    // The caller fetches; fast-forwarding only moves main to what was fetched.
    execSync('git fetch origin', { cwd: cloneDir, stdio: 'pipe' });
    const result = await fastForwardMainBranch(cloneDir);
    expect(result).toBe(true);

    // Local master should now be ahead of where it was
    const localAfter = execSync('git rev-parse master', {
      cwd: cloneDir,
      encoding: 'utf8',
    }).trim();
    expect(localAfter).not.toBe(localBefore);
  });

  it('should fast-forward when HEAD IS on master (the bug case)', async () => {
    const { remoteDir, cloneDir } = setupRemoteAndClone();
    process.chdir(cloneDir);

    // Add a commit to the remote via a separate working copy
    const pushDir = mkdtempSync(join(tmpdir(), 'worktree-push-'));
    tempDirs.push(pushDir);
    execSync(`git clone "${remoteDir}" "${pushDir}"`, { stdio: 'pipe' });
    execSync('git config user.email "other@example.com"', {
      cwd: pushDir,
      stdio: 'pipe',
    });
    execSync('git config user.name "Other User"', {
      cwd: pushDir,
      stdio: 'pipe',
    });
    writeFileSync(join(pushDir, 'new-file.txt'), 'content');
    execSync('git add .', { cwd: pushDir, stdio: 'pipe' });
    execSync('git commit -m "remote commit"', {
      cwd: pushDir,
      stdio: 'pipe',
    });
    execSync('git push', { cwd: pushDir, stdio: 'pipe' });

    // Stay on master — do NOT switch away (this is the bug scenario)
    const localBefore = execSync('git rev-parse master', {
      cwd: cloneDir,
      encoding: 'utf8',
    }).trim();

    // The caller fetches; fast-forwarding only moves main to what was fetched.
    execSync('git fetch origin', { cwd: cloneDir, stdio: 'pipe' });
    const result = await fastForwardMainBranch(cloneDir);
    expect(result).toBe(true);

    // Local master should now be ahead of where it was
    const localAfter = execSync('git rev-parse master', {
      cwd: cloneDir,
      encoding: 'utf8',
    }).trim();
    expect(localAfter).not.toBe(localBefore);
  });
});

describe('integration: countConflicts', () => {
  it('should return 0 for non-conflicting branches', async () => {
    const { cloneDir } = setupRemoteAndClone();
    process.chdir(cloneDir);

    // Create a feature branch with a non-conflicting change
    execSync('git checkout -b feature-clean', { cwd: cloneDir, stdio: 'pipe' });
    writeFileSync(join(cloneDir, 'feature-only.txt'), 'feature content');
    execSync('git add .', { cwd: cloneDir, stdio: 'pipe' });
    execSync('git commit -m "feature commit"', {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execSync('git checkout master', { cwd: cloneDir, stdio: 'pipe' });

    const conflicts = await countConflicts('feature-clean');
    expect(conflicts).toBe(0);
  });

  it('should count conflicting files', async () => {
    const { cloneDir } = setupRemoteAndClone();
    process.chdir(cloneDir);

    // Create a file on master and push it
    writeFileSync(join(cloneDir, 'shared.txt'), 'master version');
    execSync('git add .', { cwd: cloneDir, stdio: 'pipe' });
    execSync('git commit -m "master change"', {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execSync('git push', { cwd: cloneDir, stdio: 'pipe' });

    // Create a feature branch from before the master change
    execSync('git checkout -b feature-conflict HEAD~1', {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    writeFileSync(join(cloneDir, 'shared.txt'), 'feature version');
    execSync('git add .', { cwd: cloneDir, stdio: 'pipe' });
    execSync('git commit -m "conflicting change"', {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execSync('git checkout master', { cwd: cloneDir, stdio: 'pipe' });

    const conflicts = await countConflicts('feature-conflict');
    expect(conflicts).toBe(1);
  });
});

describe('integration: rebaseOntoMaster', () => {
  it('should successfully rebase a clean branch', async () => {
    const { cloneDir } = setupRemoteAndClone();
    process.chdir(cloneDir);

    // Create worktree with a feature branch
    const wtPath = await createWorktree('feature-rebase', scope());
    expect(wtPath).not.toBeNull();

    // Add a non-conflicting commit in the worktree
    writeFileSync(join(wtPath!, 'feature.txt'), 'feature content');
    execSync('git add .', { cwd: wtPath!, stdio: 'pipe' });
    execSync('git commit -m "feature work"', { cwd: wtPath!, stdio: 'pipe' });

    const result = await rebaseOntoMaster(wtPath!);
    expect(result).toBe('success');

    await removeWorktree('feature-rebase', scope(), {});
  });

  it('should detect conflict and abort rebase', async () => {
    const { cloneDir } = setupRemoteAndClone();
    process.chdir(cloneDir);

    // Add a commit to master and push
    writeFileSync(join(cloneDir, 'conflict.txt'), 'master version');
    execSync('git add .', { cwd: cloneDir, stdio: 'pipe' });
    execSync('git commit -m "master change"', {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execSync('git push', { cwd: cloneDir, stdio: 'pipe' });

    // Create worktree from before the master change
    execSync('git checkout -b feature-rebase-conflict HEAD~1', {
      cwd: cloneDir,
      stdio: 'pipe',
    });
    execSync('git checkout master', { cwd: cloneDir, stdio: 'pipe' });

    const wtPath = await createWorktree('feature-rebase-conflict', scope());
    expect(wtPath).not.toBeNull();

    // Add a conflicting commit in the worktree
    writeFileSync(join(wtPath!, 'conflict.txt'), 'feature version');
    execSync('git add .', { cwd: wtPath!, stdio: 'pipe' });
    execSync('git commit -m "conflicting work"', {
      cwd: wtPath!,
      stdio: 'pipe',
    });

    const result = await rebaseOntoMaster(wtPath!);
    expect(result).toBe('conflict');

    await removeWorktree('feature-rebase-conflict', scope(), {});
  });
});

// ── Bare repo + template resolver integration tests ──────────────

function setupBareRepo(): { bareDir: string; parentDir: string } {
  // Create a normal repo, then clone it as bare
  const seedDir = mkdtempSync(join(tmpdir(), 'worktree-seed-bare-'));
  tempDirs.push(seedDir);
  execSync('git init', { cwd: seedDir, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', {
    cwd: seedDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Test User"', {
    cwd: seedDir,
    stdio: 'pipe',
  });
  execSync('git checkout -b master', { cwd: seedDir, stdio: 'pipe' });
  writeFileSync(join(seedDir, 'README.md'), '# test');
  execSync('git add .', { cwd: seedDir, stdio: 'pipe' });
  execSync('git commit -m "initial commit"', { cwd: seedDir, stdio: 'pipe' });

  // Clone as bare repo inside a parent directory
  const parentDir = mkdtempSync(join(tmpdir(), 'worktree-bare-parent-'));
  tempDirs.push(parentDir);
  const bareDir = join(parentDir, 'myrepo.git');
  execSync(`git clone --bare "${seedDir}" "${bareDir}"`, { stdio: 'pipe' });

  return { bareDir, parentDir };
}

describe('integration: bare repo with template resolver', () => {
  it('should create worktree as sibling using template resolver', async () => {
    const { bareDir, parentDir } = setupBareRepo();
    process.chdir(bareDir);

    template = '../{session}';

    const path = await createWorktree('feature/sidebar', scope());
    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);
    // Sibling of the bare repo
    expect(path).toBe(join(parentDir, 'feature-sidebar'));

    await removeWorktree('feature/sidebar', scope(), {});
  });

  it('should list only resolver-owned worktrees', async () => {
    const { bareDir } = setupBareRepo();
    process.chdir(bareDir);

    template = '../{session}';

    await createWorktree('feature/a', scope());
    await createWorktree('feature/b', scope());

    const worktrees = await listWorktrees(scope());
    expect(worktrees).toHaveLength(2);
    expect(worktrees.map((w) => w.branch).sort()).toEqual([
      'feature/a',
      'feature/b',
    ]);

    await removeWorktree('feature/a', scope(), {});
    await removeWorktree('feature/b', scope(), {});
  });

  it('should remove the correct worktree', async () => {
    const { bareDir, parentDir } = setupBareRepo();
    process.chdir(bareDir);

    template = '../{session}';

    await createWorktree('feature/remove-me', scope());
    const wtPath = join(parentDir, 'feature-remove-me');
    expect(existsSync(wtPath)).toBe(true);

    const removed = await removeWorktree('feature/remove-me', scope(), {});
    expect(removed).toBe(true);
    expect(existsSync(wtPath)).toBe(false);
  });
});

let template: string | undefined;
function scope(cwd = process.cwd(), machine?: Machine) {
  return worktreeScope(cwd, { template, machine });
}
