import { MutationCache, QueryClient } from '@tanstack/react-query';
import { pullRequestKey, type PullRequestRef } from '@n10/vcs-core/pr-details';
import { writable } from './repo-switch.js';

/**
 * The renderer's data layer: every host call is a TanStack Query so
 * refetch cadence, caching, dedupe and invalidation live in one place
 * instead of ad-hoc setInterval/useEffect pairs in components. Every
 * mutation waits out an optimistic repository switch first
 * (`repo-switch.ts`).
 */
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({ onMutate: () => writable() }),
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

export const keys = {
  /** The open repository: what the workspace shows. */
  repo: ['repo'] as const,
  /** Any repository's info, open or not: a pane of one that is not
   *  open renders against it. */
  repoInfo: (cwd: string) => ['repo-info', cwd] as const,
  version: ['version'] as const,
  recents: ['recents'] as const,
  sidebar: (cwd: string) => ['sidebar', cwd] as const,
  sync: (cwd: string) => ['sync', cwd] as const,
  branches: (cwd: string) => ['branches', cwd] as const,
  settings: (cwd: string) => ['settings', cwd] as const,
  sessions: (cwd: string) => ['sessions', cwd] as const,
  /** A branch's agents and terminals; `branchSessionsAll` is every
   *  branch's, for writes that change any of them. */
  branchSessions: (cwd: string, branch: string) =>
    ['branch-sessions', cwd, branch] as const,
  branchSessionsAll: ['branch-sessions'] as const,
  /** Not repo-scoped: a terminal belongs to a directory, and the host
   *  lists every one whatever repository is open. */
  terminals: ['terminals'] as const,
  /** Not repo-scoped either: agents alive in *other* repositories, the
   *  same answer whichever repository is open. */
  foreignSessions: ['foreign-sessions'] as const,
  /** Not repo-scoped: orchestrators and players span repositories. */
  orchestratorGroups: ['orchestrator-groups'] as const,
  /** Not repo-scoped: machines belong to this app instance, not to a
   *  repository. */
  machines: ['machines'] as const,
  beamStatus: ['beam-status'] as const,
  agentOptions: (cwd: string) => ['agent-options', cwd] as const,
  /** A pull request resolved to commits: keyed by the head it was
   *  asked to read, so a pinned head is one entry however often the
   *  list reports a newer one. */
  prDiffManifest: (
    cwd: string,
    prId: number,
    source: string,
    target: string,
    head: string
  ) => ['pr-diff-manifest', cwd, prId, source, target, head] as const,
  /** One batch of a pull request's files, keyed by the commits it is
   *  read between (`base..head`): what is between them never changes. */
  prDiffBatch: (cwd: string, range: string, batch: string) =>
    ['pr-diff-batch', cwd, range, batch] as const,
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
  /** A pull request's revision history, read for one visit: the last
   *  visit it reports is fixed for that visit (`use-pr-history.ts`). */
  prHistory: (
    cwd: string,
    ref: PullRequestRef,
    viewer: string | null,
    visitId: string
  ) =>
    [
      'pr-history',
      cwd,
      pullRequestKey(ref),
      ref.id ?? null,
      viewer,
      visitId,
    ] as const,
  /** The files between two revisions: what is between them never
   *  changes, and the target commit only decides the base note. */
  prRangeManifest: (cwd: string, from: string, to: string, target: string) =>
    ['pr-range-manifest', cwd, from, to, target] as const,
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
  /** People a comment on one pull request can mention, by what was
   *  typed after `@`. Keyed like `prSnapshot`. */
  mentions: (
    cwd: string,
    ref: PullRequestRef | null,
    viewer: string | null,
    query: string
  ) =>
    [
      'mentions',
      cwd,
      ref ? pullRequestKey(ref) : null,
      ref?.id ?? null,
      viewer,
      query.toLowerCase(),
    ] as const,
  activity: (cwd: string) => ['session-activity', cwd] as const,
  commentImage: (cwd: string, url: string) =>
    ['comment-image', cwd, url] as const,
  drafts: (cwd: string, prId: number) => ['drafts', cwd, prId] as const,
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
  'pr-history',
  'comment-image',
  'drafts',
]);

/**
 * Drop what the provider answered for `cwd`, which now names another
 * provider, repository or account. Other repositories' answers stay,
 * and so does the page that made the change — Settings — on screen.
 */
export function resetProviderScopedCache(qc: QueryClient, cwd: string): void {
  qc.removeQueries({
    predicate: ({ queryKey: [kind, scope] }) =>
      PROVIDER_KEYS.has(String(kind)) && scope === cwd,
  });
}

/**
 * What a repository's panes and sidebar are drawn from, kept for as
 * long as the app is open: a repository left hours ago is shown from
 * these at once, and refreshed behind them. Diff text and worker
 * results are left to the default collection: they are large, and
 * read again locally.
 */
const RETAINED_KEYS = [
  keys.repoInfo('')[0],
  keys.sidebar('')[0],
  keys.sync('')[0],
  keys.sessions('')[0],
  keys.branchSessionsAll[0],
  keys.agentOptions('')[0],
  keys.activity('')[0],
  keys.threads('', 0)[0],
  keys.prDescription('', 0)[0],
  keys.drafts('', 0)[0],
  'pr-snapshot',
  'pr-conversation',
  'pr-history',
  'review-drafts',
];
for (const kind of RETAINED_KEYS)
  queryClient.setQueryDefaults([kind], { gcTime: Infinity });

/**
 * Kinds keyed by a head or a range: every push leaves an entry the key
 * has moved on from, which nothing shows again. They go an hour after
 * the last pane let go of them, the span past which a parked
 * repository's data is read again anyway.
 */
const HEAD_KEYED = ['pr-checks', 'pr-diff-manifest', 'pr-range-manifest'];
for (const kind of HEAD_KEYED)
  queryClient.setQueryDefaults([kind], { gcTime: 60 * 60_000 });
