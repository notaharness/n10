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
  const byPr = new Map<number, ReviewDraft[]>();
  const drafts = (number: number) => byPr.get(number) ?? [];
  return {
    listReviewDrafts: (_cwd, { ref }) =>
      later({ ref, viewer: VIEWER, drafts: drafts(ref.number) }),
    saveReviewDraft: ({ ref, target, body }) => {
      const id = idOf(target);
      const others = drafts(ref.number).filter((d) => d.id !== id);
      if (body === '') {
        byPr.set(ref.number, others);
        return later(null);
      }
      const now = Date.now();
      const found = drafts(ref.number).find((d) => d.id === id);
      const draft: ReviewDraft = {
        id,
        target,
        body,
        createdAt: found?.createdAt ?? now,
        updatedAt: now,
        publication: { state: 'unpublished' },
      };
      byPr.set(ref.number, [...others, draft]);
      return later(draft);
    },
    discardReviewDraft: ({ ref, target }) => {
      const id = idOf(target);
      byPr.set(
        ref.number,
        drafts(ref.number).filter((d) => d.id !== id)
      );
      return later(undefined);
    },
    submitReview: ({ ref, draftIds }) => {
      const at = Date.now();
      const attempt = `demo-${at}`;
      byPr.set(
        ref.number,
        drafts(ref.number).map((d) =>
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
        { ref, viewer: VIEWER, drafts: drafts(ref.number), resumed: null },
        400
      );
    },
  };
}
