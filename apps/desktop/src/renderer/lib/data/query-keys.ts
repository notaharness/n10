import { QueryClient } from '@tanstack/react-query';
import { pullRequestKey, type PullRequestRef } from '@n10/vcs-core/pr-details';

/**
 * The renderer's data layer: every host call is a TanStack Query so
 * refetch cadence, caching, dedupe and invalidation live in one place
 * instead of ad-hoc setInterval/useEffect pairs in components.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

export const keys = {
  repo: ['repo'] as const,
  version: ['version'] as const,
  recents: ['recents'] as const,
  sidebar: (cwd: string) => ['sidebar', cwd] as const,
  sync: (cwd: string) => ['sync', cwd] as const,
  branches: (cwd: string) => ['branches', cwd] as const,
  settings: (cwd: string) => ['settings', cwd] as const,
  sessions: (cwd: string) => ['sessions', cwd] as const,
  /** Not repo-scoped: a terminal belongs to a directory, and the host
   *  lists every one whatever repository is open. */
  terminals: ['terminals'] as const,
  /** Not repo-scoped either: agents alive in *other* repositories, the
   *  same answer whichever repository is open. */
  foreignSessions: ['foreign-sessions'] as const,
  /** Not repo-scoped: machines belong to this app instance, not to a
   *  repository — must survive a repo switch (CROSS_REPO_KEYS below). */
  machines: ['machines'] as const,
  beamStatus: ['beam-status'] as const,
  agentOptions: (cwd: string) => ['agent-options', cwd] as const,
  diff: (cwd: string, source: string, target: string) =>
    ['diff', cwd, source, target] as const,
  worktreeDiff: (cwd: string, branch: string, target: string) =>
    ['worktree-diff', cwd, branch, target] as const,
  parsedDiff: (content: string) => ['parsed-diff', content] as const,
  threads: (cwd: string, prId: number) => ['threads', cwd, prId] as const,
  prDescription: (cwd: string, prId: number) =>
    ['pr-description', cwd, prId] as const,
  /** Keyed by the provider-qualified pull request, not the number —
   *  repo A's #42 and repo B's are different entries — by the
   *  repository's id where it is known, so a repository replaced at the
   *  same path never reads the old one's entry, and by the account. */
  prSnapshot: (cwd: string, ref: PullRequestRef, viewer: string | null) =>
    ['pr-snapshot', cwd, pullRequestKey(ref), ref.id ?? null, viewer] as const,
  /** Keyed like the snapshot, and by the head the list row names: a
   *  push is a new read. `prChecksFor(cwd, ref)` is every entry of one
   *  pull request's, for its refresh. */
  prChecks: (
    cwd: string,
    ref: PullRequestRef,
    viewer: string | null,
    head: string | null
  ) =>
    [
      'pr-checks',
      cwd,
      pullRequestKey(ref),
      ref.id ?? null,
      viewer,
      head,
    ] as const,
  prChecksFor: (cwd: string, ref: PullRequestRef) =>
    ['pr-checks', cwd, pullRequestKey(ref)] as const,
  /** Every conversation read in this repository, to invalidate. */
  prConversations: (cwd: string) => ['pr-conversation', cwd] as const,
  /** Keyed like `prSnapshot`. */
  prConversation: (cwd: string, ref: PullRequestRef, viewer: string | null) =>
    [
      'pr-conversation',
      cwd,
      pullRequestKey(ref),
      ref.id ?? null,
      viewer,
    ] as const,
  /** The reviewer's own drafts on one pull request, by identity. */
  reviewDrafts: (
    cwd: string,
    ref: PullRequestRef | null,
    viewer: string | null
  ) =>
    [
      'review-drafts',
      cwd,
      ref ? pullRequestKey(ref) : null,
      ref?.id ?? null,
      viewer,
    ] as const,
  activity: (cwd: string) => ['session-activity', cwd] as const,
  commentImage: (url: string) => ['comment-image', url] as const,
  drafts: (cwd: string, prId: number) => ['drafts', cwd, prId] as const,
  reviewViewer: (cwd: string) => ['review-viewer', cwd] as const,
  branchRemoval: (cwd: string, branch: string) =>
    ['branch-removal', cwd, branch] as const,
  // Diff-worker results (see lib/highlight.ts). `linesKey` is a hash of
  // the lines' types and contents, not of the array instance, so the
  // same lines are one cache entry however many arrays hold them —
  // which is what keeps the review walkthrough, whose snippet array is
  // rebuilt every render, off the worker.
  fileAnalysis: (file: string, linesKey: string, theme: string) =>
    ['file-analysis', file, linesKey, theme] as const,
  codeTokens: (tag: string, theme: string, code: string) =>
    ['code-tokens', tag, theme, code] as const,
};

/** Keys that survive a repository switch. */
const CROSS_REPO_KEYS: ReadonlySet<string> = new Set([
  keys.repo[0],
  keys.terminals[0],
  keys.foreignSessions[0],
  keys.machines[0],
  keys.beamStatus[0],
]);

/**
 * Keys whose answers came from the pull request provider, read as the
 * configured account. A change of provider, repository or account makes
 * every one of them someone else's; git-side and local answers (diffs,
 * branches, sessions, settings) are unaffected and stay.
 */
const PROVIDER_KEYS: ReadonlySet<string> = new Set([
  'sidebar',
  'sync',
  'threads',
  'pr-description',
  'pr-snapshot',
  'comment-image',
  'drafts',
  'review-viewer',
]);

/**
 * Drop what the provider answered for the open repository, which now
 * names another provider, repository or account. Narrower than a
 * repository switch: the page that made the change — Settings — keeps
 * its own answer and stays on screen.
 */
export function resetProviderScopedCache(qc: QueryClient): void {
  qc.removeQueries({
    predicate: (query) => PROVIDER_KEYS.has(String(query.queryKey[0])),
  });
}

/**
 * Drop everything cached for the repository being left.
 *
 * Every other key is repo-scoped — sidebar, diffs, threads, settings —
 * and in-flight mutation state goes too, so a worktree removal pending
 * in the old repo cannot hide a same-named row in the new one.
 *
 * Two entries are deliberately spared. The repo entry: the gate
 * observes it, and removing it would drop that observer into its
 * pending state for a frame, flashing the loading screen between two
 * workspaces. And the two cross-repository listings — terminals, which
 * belong to directories rather than to the repository being left, and
 * agents alive in other repositories — since the tab strip is
 * reconciled against both wherever the user goes.
 */
export function resetRepoScopedCache(qc: QueryClient): void {
  qc.removeQueries({
    predicate: (query) => !CROSS_REPO_KEYS.has(String(query.queryKey[0])),
  });
  qc.getMutationCache().clear();
}
