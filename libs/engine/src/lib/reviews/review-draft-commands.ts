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
import { createReviewContext } from './review-context.js';
import type { ReviewCommandOptions } from './review-commands.js';

/** Account-scoped draft persistence and publication over core's durable ledger. */
export function createReviewDraftCommands(
  options: ReviewCommandOptions,
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
      const start = context.selected();
      const { provider, config, vcsConfigured } = start;
      const publish = vcsConfigured
        ? provider?.publishReview?.bind(provider)
        : undefined;
      try {
        const filed = await submitReview(req, {
          ...context.sources,
          publish:
            publish &&
            ((submission, ledger) => {
              context.assertWritable(start);
              return publish(
                config.vendorAuth,
                config.vendorProject,
                submission,
                ledger
              );
            }),
        });
        return filed;
      } finally {
        // A failed publication can still have filed individual comments.
        invalidate();
        // A verdict changes the reviewers the list shows. The answer does
        // not wait for it, and a read never rejects: a failure stays in
        // the list's snapshot.
        void options.pullRequests.read(options.config.repo, { force: true });
      }
    },
    async mentions(request: unknown) {
      const req = parseMentionSearchRequest(request);
      const { config, provider, vcsConfigured } = context.selected();
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
