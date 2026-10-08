import type {
  DraftTarget,
  N10HostApi,
  ReviewDraft,
} from '../../../host/contract.js';
import { VIEWER } from '../data/identity.js';
import { later } from './hub.js';

/**
 * The reviewer's private drafts, kept for as long as the demo page is
 * open: the demo has no disk to save them to. Submitting marks the
 * chosen drafts published; nothing leaves the page.
 */

type DraftsHost = Pick<
  N10HostApi,
  'listReviewDrafts' | 'saveReviewDraft' | 'discardReviewDraft' | 'submitReview'
>;

/** One draft per target, as the host keeps them. */
function idOf(target: DraftTarget): string {
  if ('threadId' in target) return `${target.kind}:${target.threadId}`;
  if ('key' in target) return `${target.kind}:${String(target.key)}`;
  return target.kind;
}

export function createDraftsHost(): DraftsHost {
  // By repository and number: two demo repositories can share a pull
  // request number.
  const byPr = new Map<string, ReviewDraft[]>();
  const prKey = (ref: { repository: string; number: number }) =>
    `${ref.repository}#${ref.number}`;
  const drafts = (ref: { repository: string; number: number }) =>
    byPr.get(prKey(ref)) ?? [];
  return {
    listReviewDrafts: (_cwd, { ref }) =>
      later({ ref, viewer: VIEWER, drafts: drafts(ref) }),
    saveReviewDraft: ({ ref, target, body }) => {
      const id = idOf(target);
      const others = drafts(ref).filter((d) => d.id !== id);
      if (body === '') {
        byPr.set(prKey(ref), others);
        return later(null);
      }
      const now = Date.now();
      const found = drafts(ref).find((d) => d.id === id);
      const draft: ReviewDraft = {
        id,
        target,
        body,
        createdAt: found?.createdAt ?? now,
        updatedAt: now,
        publication: { state: 'unpublished' },
      };
      byPr.set(prKey(ref), [...others, draft]);
      return later(draft);
    },
    discardReviewDraft: ({ ref, target }) => {
      const id = idOf(target);
      byPr.set(
        prKey(ref),
        drafts(ref).filter((d) => d.id !== id)
      );
      return later(undefined);
    },
    submitReview: ({ ref, draftIds }) => {
      const at = Date.now();
      const attempt = `demo-${at}`;
      byPr.set(
        prKey(ref),
        drafts(ref).map((d) =>
          draftIds.includes(d.id)
            ? {
                ...d,
                publication: {
                  state: 'published',
                  attempt,
                  remoteId: attempt,
                  at,
                },
              }
            : d
        )
      );
      return later(
        { ref, viewer: VIEWER, drafts: drafts(ref), resumed: null },
        400
      );
    },
  };
}
