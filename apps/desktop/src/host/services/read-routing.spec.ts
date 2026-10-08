import { beforeEach, expect, it, vi } from 'vitest';

/**
 * Every read a pane or the sidebar makes answers for the repository it
 * names, never the selected one: a parked repository's pane must not be
 * shown the open repository's data. `repository(cwd)` and the selected-
 * repository accessors hand out distinct stub handles, and each read is
 * asked about `/parked`; the handle it touched is what it read.
 */

const touched = vi.hoisted(() => [] as string[]);

vi.mock('./repo.js', () => {
  const handle = (cwd: string) => {
    const touch = <T>(value: T): T => {
      touched.push(cwd);
      return value;
    };
    const resource = () =>
      touch({
        read: async () => ({ data: cwd, error: null }),
      });
    return {
      cwd,
      config: { getSnapshot: () => touch({ config: {} }) },
      worktrees: {
        read: async () => touch({ allBranches: [cwd], error: null }),
      },
      sessions: {
        connections: () => touch([]),
        branchSessions: () => touch({}),
      },
      reviews: {
        comments: resource,
        description: resource,
        snapshot: resource,
        checks: resource,
        conversation: resource,
        history: resource,
        recordVisit: async () => touch(undefined),
        drafts: { list: async () => touch({}) },
        agentComments: { resource },
        diff: {
          manifest: resource,
          patch: resource,
          rangeManifest: resource,
          worktree: resource,
        },
      },
    };
  };
  const selected = handle('/selected');
  return {
    repository: handle,
    requireRepo: () => '/selected',
    activeRepository: () => selected,
    openRepository: () => selected,
    activeReviewService: () => selected.reviews,
    activeWorktreeService: () => selected.worktrees,
    activeConfigService: () => selected.config,
  };
});
vi.mock('./terminals.js', () => ({
  launchTerminal: vi.fn(),
  listTerminals: () => [],
}));

const PARKED = '/parked';
const req = { repo: PARKED };

const READS: [string, () => Promise<unknown>][] = [
  [
    'pull request snapshot',
    async () =>
      (await import('./pr-details.js')).getPullRequestSnapshot(PARKED, {}),
  ],
  [
    'pull request checks',
    async () =>
      (await import('./pr-checks.js')).getPullRequestChecks(PARKED, {}),
  ],
  [
    'pull request conversation',
    async () =>
      (await import('./pr-conversation.js')).getPullRequestConversation(
        PARKED,
        {}
      ),
  ],
  [
    'pull request history',
    async () =>
      (await import('./pr-history.js')).getPullRequestHistory(PARKED, {}),
  ],
  [
    'visit record',
    async () =>
      (await import('./pr-history.js')).recordPullRequestVisit(PARKED, {}),
  ],
  [
    'comment threads',
    async () => (await import('./reviews.js')).fetchCommentThreads(PARKED, 7),
  ],
  [
    'description',
    async () => (await import('./reviews.js')).fetchPrDescription(PARKED, 7),
  ],
  [
    'diff manifest',
    async () => (await import('./reviews.js')).getPrDiffManifest(req),
  ],
  [
    'diff patch',
    async () => (await import('./reviews.js')).getPrDiffPatch(req),
  ],
  [
    'diff range manifest',
    async () => (await import('./reviews.js')).getPrRangeManifest(req),
  ],
  [
    'agent findings',
    async () => (await import('./drafts.js')).listDraftComments(PARKED, 7),
  ],
  [
    'review drafts',
    async () => (await import('./review-drafts.js')).listDrafts(PARKED, {}),
  ],
  [
    'sessions',
    async () => (await import('./sessions.js')).listSessions(PARKED),
  ],
  [
    'branch sessions',
    async () =>
      (await import('./branch-sessions.js')).listBranchSessions(
        PARKED,
        'feature'
      ),
  ],
  [
    'agent options',
    async () =>
      (await import('./session-launch-options.js')).listAgentOptions(PARKED),
  ],
  [
    'worktree diff',
    async () =>
      (await import('./worktrees.js')).getWorktreeDiffText(
        PARKED,
        'feature',
        'main'
      ),
  ],
  [
    'all branches',
    async () => (await import('./worktrees.js')).listAllBranches(PARKED),
  ],
];

beforeEach(() => {
  touched.length = 0;
});

it.each(READS)('reads %s from the repository it names', async (_, read) => {
  await read();
  expect(touched).not.toHaveLength(0);
  expect(new Set(touched)).toEqual(new Set([PARKED]));
});
