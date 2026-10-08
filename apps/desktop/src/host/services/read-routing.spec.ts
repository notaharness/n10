import { beforeEach, expect, it, vi } from 'vitest';
import { listBranchSessions } from './branch-sessions.js';
import { getGuidedReview, listDraftComments } from './drafts.js';
import { getPullRequestChecks } from './pr-checks.js';
import { getPullRequestConversation } from './pr-conversation.js';
import { getPullRequestSnapshot } from './pr-details.js';
import { getPullRequestHistory, recordPullRequestVisit } from './pr-history.js';
import { listDrafts } from './review-drafts.js';
import {
  fetchCommentThreads,
  fetchPrDescription,
  getPrDiffManifest,
  getPrDiffPatch,
  getPrRangeManifest,
} from './reviews.js';
import { listAgentOptions } from './session-launch-options.js';
import { listSessions } from './sessions.js';
import { getWorktreeDiffText, listAllBranches } from './worktrees.js';

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
        read: () => touch({ allBranches: [cwd], error: null }),
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
        recordVisit: () => touch(undefined),
        drafts: { list: () => touch({}) },
        agentComments: { resource },
        agentGuide: {
          resource: () =>
            touch({ read: async () => ({ data: { guide: cwd }, error: null }) }),
        },
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

const READS: [string, () => unknown][] = [
  ['pull request snapshot', () => getPullRequestSnapshot(PARKED, {})],
  ['pull request checks', () => getPullRequestChecks(PARKED, {})],
  ['pull request conversation', () => getPullRequestConversation(PARKED, {})],
  ['pull request history', () => getPullRequestHistory(PARKED, {})],
  ['visit record', () => recordPullRequestVisit(PARKED, {})],
  ['comment threads', () => fetchCommentThreads(PARKED, 7)],
  ['description', () => fetchPrDescription(PARKED, 7)],
  ['diff manifest', () => getPrDiffManifest(req)],
  ['diff patch', () => getPrDiffPatch(req)],
  ['diff range manifest', () => getPrRangeManifest(req)],
  ['agent findings', () => listDraftComments(PARKED, 7)],
  ['guided review', () => getGuidedReview(PARKED, 7)],
  ['review drafts', () => listDrafts(PARKED, {})],
  ['sessions', () => listSessions(PARKED)],
  ['branch sessions', () => listBranchSessions(PARKED, 'feature')],
  ['agent options', () => listAgentOptions(PARKED)],
  ['worktree diff', () => getWorktreeDiffText(PARKED, 'feature', 'main')],
  ['all branches', () => listAllBranches(PARKED)],
];

beforeEach(() => {
  touched.length = 0;
});

it.each(READS)('reads %s from the repository it names', async (_, read) => {
  await read();
  expect(touched).not.toHaveLength(0);
  expect(new Set(touched)).toEqual(new Set([PARKED]));
});
