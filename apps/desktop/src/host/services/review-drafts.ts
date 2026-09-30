import {
  discardReviewDraft,
  parseSubmitReviewRequest,
  submitReview as submitDraftsAsReview,
  listReviewDrafts,
  parseDiscardDraftRequest,
  parseDraftsRequest,
  parseSaveDraftRequest,
  saveReviewDraft,
  type DraftSources,
  type ReviewDraft,
  type ReviewDrafts,
  type SubmittedReview,
} from '@n10/core';
import { openContext } from './open-context.js';
import { resolveProvider } from './program.js';
import { requireRepo } from './repo.js';

/**
 * The reviewer's own drafts on the pull request on screen: replies,
 * conversation comments, the review summary. Kept on this machine by
 * account and pull request (core's review-drafts store); nothing here
 * writes to the provider.
 *
 * Requests are parsed as untrusted, and core refuses any for another
 * repository or account than the open one.
 */

function sources(): DraftSources {
  return openContext(requireRepo());
}

export async function listDrafts(request: unknown): Promise<ReviewDrafts> {
  return listReviewDrafts(parseDraftsRequest(request), sources());
}

export async function saveDraft(request: unknown): Promise<ReviewDraft | null> {
  return saveReviewDraft(parseSaveDraftRequest(request), sources());
}

export async function discardDraft(request: unknown): Promise<void> {
  discardReviewDraft(parseDiscardDraftRequest(request), sources());
}

/**
 * File the chosen drafts as one review through the configured provider.
 * Nothing is sent unless the reviewer asked for exactly this; a review
 * that stops part-way is resumed by the next call, never repeated.
 */
export async function submitReview(request: unknown): Promise<SubmittedReview> {
  const req = parseSubmitReviewRequest(request);
  const cwd = requireRepo();
  const { config, provider, configured } = resolveProvider(cwd);
  const publish = configured
    ? provider?.publishReview?.bind(provider)
    : undefined;
  return submitDraftsAsReview(req, {
    ...openContext(cwd),
    publish:
      publish &&
      ((submission, ledger) =>
        publish(config.vendorAuth, config.vendorProject, submission, ledger)),
  });
}
