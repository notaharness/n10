import { isDeepStrictEqual } from 'node:util';
import { configEffects } from '../config/config-effects.js';
import type { WorktreeService } from '../worktrees/worktree-service.js';
import { createProviderReads } from './provider-reads.js';
import { createDiffReads } from './diff-reads.js';
import type { ReviewContextOptions } from './review-context.js';

/** Repository lifetime, with separate invalidation for identity and local paths. */
export function createReviewService(
  options: ReviewContextOptions & { worktrees: WorktreeService }
) {
  const provider = createProviderReads(options);
  const diff = createDiffReads(options.config.repo, options.worktrees);
  let rows = options.pullRequests.getSnapshot(options.config.repo).prMap;
  const unsubscribeRows = options.pullRequests.subscribe((repo) => {
    if (repo !== options.config.repo) return;
    const next = options.pullRequests.getSnapshot(repo).prMap;
    if (isDeepStrictEqual(rows, next)) return;
    rows = next;
    provider.invalidate();
  });
  let snapshot = options.config.getSnapshot();
  const unsubscribe = options.config.subscribe(() => {
    const next = options.config.getSnapshot();
    const credentials =
      configEffects(snapshot.config, next.config).credentials ||
      snapshot.viewer !== next.viewer;
    const path = snapshot.config.worktreePath !== next.config.worktreePath;
    snapshot = next;
    if (credentials) provider.reset();
    if (credentials || path) diff.reset();
  });
  return {
    comments: provider.comments,
    description: provider.description,
    snapshot: provider.snapshot,
    checks: provider.checks,
    conversation: provider.conversation,
    diff,
    invalidateProvider() {
      provider.invalidate();
    },
    dispose() {
      unsubscribeRows();
      unsubscribe();
      provider.dispose();
      diff.dispose();
    },
  };
}
export type ReviewService = ReturnType<typeof createReviewService>;
