import type { ReviewDraft } from './review-draft-types.js';

/**
 * Chosen comments on code written on a commit other than the one being
 * filed on: their line numbers belong to that commit, and at the same
 * numbers the filed one may hold unrelated code. Nothing is sent; each
 * is placed again on the new head first.
 */
export class DraftsOnOtherCommitError extends Error {
  constructor(readonly draftIds: string[], readonly head: string) {
    super(
      `${
        draftIds.length === 1
          ? 'A comment was'
          : `${draftIds.length} comments were`
      } written on another commit than ${head.slice(
        0,
        7
      )}; open the diff at ${head.slice(0, 7)} and place ${
        draftIds.length === 1 ? 'it' : 'them'
      } again`
    );
    this.name = 'DraftsOnOtherCommitError';
  }
}

export function assertAnchoredAt(chosen: ReviewDraft[], head: string): void {
  const stale = chosen.filter(
    (d) => d.target.kind === 'inline' && d.target.anchor.head !== head
  );
  if (stale.length) {
    throw new DraftsOnOtherCommitError(
      stale.map((d) => d.id),
      head
    );
  }
}
