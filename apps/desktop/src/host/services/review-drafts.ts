import {
  discardReviewDraft,
  listReviewDrafts,
  parseDiscardDraftRequest,
  parseDraftsRequest,
  parseSaveDraftRequest,
  PullRequestIdentityError,
  saveReviewDraft,
  type DraftSources,
  type ReviewDraft,
  type ReviewDrafts,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { activeRepoIs, configuredRepository, requireRepo } from './repo.js';
import { configuredViewer } from './viewer.js';

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
  const cwd = requireRepo();
  return {
    repository: () => {
      if (!activeRepoIs(cwd)) {
        throw new PullRequestIdentityError(
          `${cwd} is no longer the repository open in n10`
        );
      }
      return configuredRepository(readConfig(cwd));
    },
    viewer: () => configuredViewer(readConfig(cwd)),
  };
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
