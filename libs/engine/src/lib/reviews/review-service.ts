import { createAgentComments } from './agent-comments.js';
import { isDeepStrictEqual } from 'node:util';
import type { VisitBaselines } from '@n10/core';
import { configEffects } from '../config/api.js';
import type { WorktreeService } from '../worktrees/api.js';
import { createProviderReads } from './provider-reads.js';
import { createDiffReads } from './diff-reads.js';
import { createHistoryReads } from './history-reads.js';
import {
  createReviewCommands,
  type ReviewCommandOptions,
} from './review-commands.js';
import { createReviewDraftCommands } from './review-draft-commands.js';

/** Repository lifetime, with separate invalidation for identity and local paths. */
export function createReviewService(
  options: ReviewCommandOptions & {
    worktrees: WorktreeService;
    /** Visit baselines outlive a repository handle; see `history-reads.ts`. */
    baselines: VisitBaselines;
  }
) {
  const provider = createProviderReads(options);
  const history = createHistoryReads(options);
  const agentComments = createAgentComments(options, provider.invalidate);
  const diff = createDiffReads(
    options.config.repo,
    options.isCurrent,
    options.worktrees
  );
  let rows = options.pullRequests.getSnapshot(options.config.repo).prMap;
  const unsubscribeRows = options.pullRequests.subscribe((repo) => {
    if (repo !== options.config.repo) return;
    const next = options.pullRequests.getSnapshot(repo).prMap;
    if (isDeepStrictEqual(rows, next)) return;
    rows = next;
    provider.invalidate();
    history.invalidate();
    diff.invalidate();
  });
  let snapshot = options.config.getSnapshot();
  const unsubscribe = options.config.subscribe(() => {
    const next = options.config.getSnapshot();
    const credentials =
      configEffects(snapshot.config, next.config).credentials ||
      snapshot.viewer !== next.viewer;
    const path = snapshot.config.worktreePath !== next.config.worktreePath;
    snapshot = next;
    if (credentials) {
      provider.reset();
      history.reset();
    }
    if (credentials || path) diff.reset();
  });
  return {
    repo: options.config.repo,
    agentComments,
    commands: createReviewCommands(options, provider),
    drafts: createReviewDraftCommands(options, provider.invalidate),
    comments: provider.comments,
    description: provider.description,
    snapshot: provider.snapshot,
    checks: provider.checks,
    conversation: provider.conversation,
    diff,
    history: history.history,
    recordVisit: history.recordVisit,
    invalidateProvider() {
      provider.invalidate();
    },
    dispose() {
      agentComments.dispose();
      unsubscribeRows();
      unsubscribe();
      provider.dispose();
      history.dispose();
      diff.dispose();
    },
  };
}
export type ReviewService = ReturnType<typeof createReviewService>;
