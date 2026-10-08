import { startBabysitForRepo, stopBabysitForBranch } from './babysit.js';
import { canonicalRepoPath, isGitRepo, resetRepoRoot } from '@n10/core';
import {
  createRepositoryService,
  type ConfigService,
  type RepositoryHandle,
} from '@n10/engine';
import { pullRequests } from './program.js';
import { PROVIDERS } from './providers.js';
import {
  NoActiveRepoError,
  type RecentRepoEntry,
  type RepoInfo,
} from '../contract.js';
import {
  loadRecents,
  forgetRecent,
  recordOpen,
  saveRecents,
  withColors,
  type RecentRepo,
} from './recent-repos.js';

// The babysit module imports this one: its bindings are read on call,
// not while the modules load.
const repositories = createRepositoryService({
  providers: PROVIDERS,
  pullRequests,
  worktreeWatchers: {
    suspend: (repo, branch) => stopBabysitForBranch(repo, branch),
    resume: (repo, id) => startBabysitForRepo(repo, id),
    isCurrent: activeRepoIs,
  },
});

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

/** The open repository, or null before one is open. */
export function openRepository(): RepositoryHandle | null {
  return repositories.getSnapshot();
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
  const opened = repositories.open(path);
  // Plan delivery still resolves the process repo root.
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

/** The repository at `cwd` for reading, selected or parked: the reads
 *  a pane makes name the repository its tab belongs to. */
export function repository(cwd: string): RepositoryHandle {
  return repositories.get(cwd);
}

/** What `getRepo` says, for any repository: a pane of one that is not
 *  open needs its provider and account too. */
export function getRepoInfo(cwd: string): RepoInfo {
  return repoInfo(repository(cwd));
}

/** Bring `cwd`'s data up to date behind what it holds, unless a parked
 *  repository's is still warm. Returns at once. */
export function prewarmRepo(cwd: string): void {
  repository(cwd).prewarm();
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
    reviewEvents:
      vcsConfigured && provider?.publishReview
        ? provider.reviewEvents ?? []
        : [],
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
export function listRecentRepos(): RecentRepoEntry[] {
  return withColors(canonicalRecents(loadRecents()))
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
