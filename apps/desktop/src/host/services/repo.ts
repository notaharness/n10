import { startBabysitForRepo, stopBabysitForBranch } from './babysit.js';
import { canonicalRepoPath, isGitRepo, resetRepoRoot } from '@n10/core';
import type { ConfigService, RepositoryHandle } from '@n10/engine';
import { repositories } from './program.js';
import { NoActiveRepoError, type RepoInfo } from '../contract.js';
import {
  loadRecents,
  forgetRecent,
  recordOpen,
  saveRecents,
  type RecentRepo,
} from './recent-repos.js';

let repoOpenedListener: ((cwd: string) => void) | null = null;

export function setRepoOpenedListener(fn: (cwd: string) => void): void {
  repoOpenedListener = fn;
}

/** The recents list under canonical paths, one entry per repository —
 *  an entry written under a symlink path before this canonicalisation
 *  existed collapses onto its real one, newest kept. */
function canonicalRecents(recents: RecentRepo[]): RecentRepo[] {
  const seen = new Set<string>();
  const out: RecentRepo[] = [];
  for (const r of recents) {
    const cwd = canonicalRepoPath(r.cwd);
    if (seen.has(cwd)) continue;
    seen.add(cwd);
    out.push(cwd === r.cwd ? r : { ...r, cwd });
  }
  return out;
}

export function activeRepository(): RepositoryHandle {
  const current = repositories.getSnapshot();
  if (!current) throw new NoActiveRepoError();
  return current;
}

export function requireRepo(): string {
  return activeRepository().cwd;
}

/** Whether `cwd` is still the open repository. Long, awaiting host work
 *  checks this between steps: opening another repo mid-flight would
 *  otherwise let it finish against the wrong checkout. */
export function activeRepoIs(cwd: string): boolean {
  return repositories.isActive(cwd);
}

export function openRepo(path: string): RepoInfo {
  const previous = repositories.getSnapshot();
  const opened = repositories.open(path, {
    worktreeWatchers: {
      suspend: stopBabysitForBranch,
      resume: startBabysitForRepo,
      isCurrent: activeRepoIs,
    },
  });
  // Plan delivery and babysitters still resolve the process repo root.
  // Keep their ambient scope aligned until those domains take explicit handles.
  process.chdir(opened.cwd);
  resetRepoRoot();
  try {
    saveRecents(recordOpen(canonicalRecents(loadRecents()), opened.cwd));
  } catch {
    // Recent-repos bookkeeping must never block opening a repo.
  }
  if (opened !== previous) repoOpenedListener?.(opened.cwd);
  return repoInfo(opened);
}

export function getRepo(): RepoInfo | null {
  const current = repositories.getSnapshot();
  if (!current) return null;
  return repoInfo(current);
}

/** Explicit refresh at renderer boot: disk edits must update account identity
 * before identity-scoped queries run. Snapshot reads themselves remain pure. */
export function refreshRepo(): RepoInfo | null {
  repositories.getSnapshot()?.config.reload();
  return getRepo();
}

function repoInfo(current: RepositoryHandle): RepoInfo {
  const { provider, vcsConfigured, repository, viewer } =
    current.config.getSnapshot();
  return {
    cwd: current.cwd,
    providerId: provider?.id ?? null,
    vcsConfigured,
    repository,
    viewer,
  };
}

export function activeWorktreeService() {
  const current = repositories.getSnapshot();
  if (!current) throw new NoActiveRepoError();
  return current.worktrees;
}

export function activeConfigService(): ConfigService {
  const current = repositories.getSnapshot();
  if (!current) throw new NoActiveRepoError();
  return current.config;
}

/**
 * Startup repo resolution, in priority order:
 *   1. N10_START_DIR (`n10` and dev.mjs pass the invoking shell's cwd)
 *   2. the most recently opened repo that still exists on disk
 * Falls back to null (repo-open screen) when neither applies.
 */
export function openStartupRepo(
  env: Record<string, string | undefined> = process.env,
  recents: RecentRepo[] = loadRecents()
): RepoInfo | null {
  const startDir = env.N10_START_DIR;
  if (startDir) {
    try {
      return openRepo(startDir);
    } catch (err: unknown) {
      console.warn(
        `[desktop] failed to open start dir ${startDir}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  // Restore the last session: newest recent that still validates.
  for (const r of recents) {
    if (!isGitRepo(r.cwd)) continue;
    try {
      console.log(`[desktop] restoring last repo: ${r.cwd}`);
      return openRepo(r.cwd);
    } catch (err: unknown) {
      console.warn(
        `[desktop] failed to restore ${r.cwd}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return null;
}

/**
 * Recently opened repositories, newest first. Each entry is
 * re-validated against the filesystem so dead checkouts render as
 * invalid instead of failing on click.
 */
export function listRecentRepos(): (RecentRepo & { valid: boolean })[] {
  return canonicalRecents(loadRecents())
    .slice(0, 10)
    .map((r) => ({ ...r, valid: isGitRepo(r.cwd) }));
}

/** Forget a repository under whichever path its entry was stored — the
 *  list shows canonical paths, and the entry may predate that. */
export function forgetRecentRepo(cwd: string): void {
  const target = canonicalRepoPath(cwd);
  for (const r of loadRecents()) {
    if (canonicalRepoPath(r.cwd) === target) forgetRecent(r.cwd);
  }
}

export function activeReviewService() {
  const current = repositories.getSnapshot();
  if (!current) throw new NoActiveRepoError();
  return current.reviews;
}
