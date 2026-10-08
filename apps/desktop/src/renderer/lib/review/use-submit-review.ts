import { useState } from 'react';
import type {
  PullRequestRef,
  ReviewDrafts,
  ReviewEvent,
} from '../../../host/contract.js';
import { readError } from '../data/read-state.js';
import { keys, queryClient } from '../data/query-keys.js';
import { useRepo } from '../repo-context.js';
import {
  failureOf,
  isFiled,
  outcomeOf,
  type SubmitOutcome,
} from './review-submission.js';

export interface SubmitChoice {
  /** The head the reviewer read: the review is filed on it. */
  head: string;
  event: ReviewEvent;
  /** The summary as typed; empty for none. */
  summary: string;
  draftIds: string[];
}

/**
 * Files the review through the host's one submit, and says what came of
 * it. The summary is saved first, so the review's text is the one on
 * screen and is kept if the submit stops part-way. Whatever the answer,
 * the drafts are read back: they record what was posted.
 */
export function useSubmitReview(ref: PullRequestRef) {
  const { repo } = useRepo();
  const [outcome, setOutcome] = useState<SubmitOutcome>({ kind: 'idle' });
  const draftsKey = keys.reviewDrafts(repo.cwd, ref, repo.viewer);
  const scope = { ref, viewer: repo.viewer };

  async function summaryId(summary: string): Promise<string[]> {
    if (!summary.trim()) return [];
    const saved = await window.n10.saveReviewDraft({
      ...scope,
      target: { kind: 'summary' },
      body: summary,
    });
    return saved ? [saved.id] : [];
  }

  async function settle() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.sidebar(repo.cwd) }),
      queryClient.invalidateQueries({
        queryKey: keys.prSnapshot(repo.cwd, ref, repo.viewer),
      }),
      queryClient.invalidateQueries({
        queryKey: keys.prConversations(repo.cwd),
      }),
    ]);
  }

  /** What came of it, also kept as `outcome`. `onFiled` runs once the
   *  review is on the provider, before the outcome lets the form be
   *  edited again: what it clears cannot take what is typed next. */
  async function submit(
    choice: SubmitChoice,
    onFiled: () => void
  ): Promise<SubmitOutcome> {
    setOutcome({ kind: 'pending' });
    let ids = choice.draftIds;
    let next: SubmitOutcome;
    try {
      ids = [...(await summaryId(choice.summary)), ...ids];
      const result = await window.n10.submitReview({
        ...scope,
        head: choice.head,
        event: choice.event,
        draftIds: ids,
      });
      queryClient.setQueryData<ReviewDrafts>(draftsKey, result);
      next = outcomeOf(result, ids);
    } catch (err) {
      const reason = readError(err);
      const drafts = await queryClient
        .query({
          queryKey: draftsKey,
          queryFn: () => window.n10.listReviewDrafts(repo.cwd, scope),
          staleTime: 0,
        })
        .then((d) => d.drafts)
        .catch(() => []);
      next = failureOf(reason, drafts, ids);
    }
    if (isFiled(next)) onFiled();
    setOutcome(next);
    await settle();
    return next;
  }

  return { outcome, submit, reset: () => setOutcome({ kind: 'idle' }) };
}
