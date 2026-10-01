import {
  discardReviewDraft,
  parseSubmitReviewRequest,
  submitReview,
  listReviewDrafts,
  parseDiscardDraftRequest,
  parseDraftsRequest,
  parseSaveDraftRequest,
  saveReviewDraft,
  parseMentionSearchRequest,
  searchMentions,
} from '@n10/core';
import {
  createReviewContext,
  type ReviewContextOptions,
} from './review-context.js';

/** Account-scoped draft persistence and publication over core's durable ledger. */
export function createReviewDraftCommands(
  options: ReviewContextOptions,
  invalidate: () => void
) {
  const context = createReviewContext(options);
  return {
    async list(request: unknown) {
      return listReviewDrafts(parseDraftsRequest(request), context.sources);
    },
    async save(request: unknown) {
      return saveReviewDraft(parseSaveDraftRequest(request), context.sources);
    },
    async discard(request: unknown) {
      discardReviewDraft(parseDiscardDraftRequest(request), context.sources);
    },
    async submit(request: unknown) {
      const req = parseSubmitReviewRequest(request);
      const start = context.current();
      const { provider, config, vcsConfigured } = start;
      const publish = vcsConfigured
        ? provider?.publishReview?.bind(provider)
        : undefined;
      try {
        return await submitReview(req, {
          ...context.sources,
          publish:
            publish &&
            ((submission, ledger) => {
              context.assertUnchanged(start);
              return publish(
                config.vendorAuth,
                config.vendorProject,
                submission,
                ledger
              );
            }),
        });
      } finally {
        // A failed publication can still have filed individual comments.
        invalidate();
      }
    },
    async mentions(request: unknown) {
      const req = parseMentionSearchRequest(request);
      const { config, provider, vcsConfigured } = context.current();
      const search = vcsConfigured
        ? provider?.searchMentionCandidates?.bind(provider)
        : undefined;
      return searchMentions(req, {
        ...context.sources,
        search:
          search &&
          ((query) => search(config.vendorAuth, config.vendorProject, query)),
      });
    },
  };
}
