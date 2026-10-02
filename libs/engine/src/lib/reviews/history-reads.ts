import {
  assertSameContext,
  parseHistoryRequest,
  parseVisitRequest,
  readPullRequestHistory,
  recordPullRequestVisit,
} from '@n10/core';
import type { PullRequestHistory, VisitBaselines } from '@n10/core';
import { createResourceCache } from './resource-cache.js';
import {
  createReviewContext,
  type ReviewContextOptions,
} from './review-context.js';

const HISTORY_TTL_MS = 30_000;

/**
 * A pull request's revision history: the provider's record of its heads
 * and the viewer's latest review, and n10's record of the viewer's last
 * visit. Requests are untrusted; core checks identity around each read.
 * `baselines` outlives a repository switch, so a visit the reader began
 * before one is still the same visit after it.
 */
export function createHistoryReads(
  options: ReviewContextOptions & { baselines: VisitBaselines }
) {
  const context = createReviewContext(options);
  const { baselines } = options;
  const histories = createResourceCache<PullRequestHistory>(
    HISTORY_TTL_MS,
    32,
    // A failed read is read again; a last visit that failed froze no
    // baseline, so the visit could not be recorded until it is.
    ({ revisions, lastVisit }) =>
      revisions.state !== 'failed' && lastVisit.state !== 'failed'
  );
  return {
    history(value: unknown) {
      const parsed = parseHistoryRequest(value);
      const req = {
        ...parsed,
        viewer: assertSameContext(parsed, context.sources),
      };
      return histories.get(JSON.stringify(req), () => {
        const { config, provider, vcsConfigured } = context.current();
        const read = vcsConfigured
          ? provider?.fetchPullRequestRevisions?.bind(provider)
          : undefined;
        return readPullRequestHistory(req, {
          ...context.sources,
          revisions:
            read && ((id) => read(config.vendorAuth, config.vendorProject, id)),
          baselines,
        });
      });
    },
    /** Record the commits the reader was shown, and keep them in the clone. */
    async recordVisit(value: unknown) {
      const req = parseVisitRequest(value);
      await recordPullRequestVisit(req, {
        ...context.sources,
        cwd: options.config.repo,
        baselines,
      });
    },
    invalidate() {
      histories.invalidate();
    },
    reset() {
      histories.reset();
    },
    dispose() {
      histories.dispose();
    },
  };
}
