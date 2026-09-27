import { readConfig } from '@n10/vcs-core';
import {
  draftRepoKey,
  postReviewComments,
  readComments,
  removeComment,
  resolveComment,
  updateComment,
  type DraftScope,
  type PostContext,
  type ReviewComment,
} from '@n10/review-comments';
import { requireRepo } from './repo.js';
import type { PostDraftsRequest } from '../contract.js';

/**
 * Draft review comments written by the review agent through
 * `n10 util add-comment` (stored per repository and PR under
 * ~/.n10/reviews). The desktop shows them live in the diff and posts
 * them with the same poster the TUI uses, so both shells stay
 * interchangeable.
 */

/** IPC-boundary validation, matching reviews.ts. `prId` becomes a path
 *  segment under ~/.n10/reviews, so a non-integer value ('../..')
 *  would write outside the reviews directory entirely. */
function requirePrId(prId: unknown): number {
  if (typeof prId !== 'number' || !Number.isInteger(prId) || prId <= 0) {
    throw new Error('Invalid PR id');
  }
  return prId;
}

/** The open repository's drafts for `prId`, or null when its project
 *  names no repository to keep drafts for. */
function draftScope(prId: unknown): DraftScope | null {
  const id = requirePrId(prId);
  const config = readConfig(requireRepo());
  const repo = draftRepoKey(config.vendor, config.vendorProject);
  return repo ? { repo, prId: id } : null;
}

function requireDraftScope(prId: unknown): DraftScope {
  const scope = draftScope(prId);
  if (!scope) throw new Error('No repository is configured for drafts');
  return scope;
}

export function listDraftComments(prId: number): ReviewComment[] {
  const scope = draftScope(prId);
  return scope ? readComments(scope) : [];
}

/** TUI parity: posted comments are immutable and a comment mid-post
 *  can't be edited or deleted out from under the poster. */
function requireEditable(scope: DraftScope, id: string): void {
  const existing = readComments(scope).find((c) => c.id === id);
  if (!existing) {
    throw new Error('Draft comment no longer exists');
  }
  if (existing.status === 'posted') {
    throw new Error('Comment is already posted');
  }
  if (existing.status === 'posting') {
    throw new Error('Comment is being posted');
  }
}

export function updateDraftComment(
  prId: number,
  id: string,
  patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
): void {
  const scope = requireDraftScope(prId);
  requireEditable(scope, id);
  if (!updateComment(scope, id, resolvedPatch(scope, id, patch))) {
    throw new Error('Draft comment no longer exists');
  }
}

/**
 * Settle an edit's body against its severity before it is stored.
 *
 * A body that opens with a Conventional Comments header states a
 * severity too, so an edit can make the two disagree — and everything
 * downstream reads the stored one: the walkthrough's order, the rail
 * dot, the TUI's chip. `resolveComment` picks the louder, the same way
 * `n10 util add-comment` does when the agent writes the draft, so the
 * two write paths cannot leave the file in different shapes.
 */
function resolvedPatch(
  scope: DraftScope,
  id: string,
  patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
): Partial<Pick<ReviewComment, 'body' | 'severity'>> {
  if (patch.body === undefined) return patch;
  const existing = readComments(scope).find((c) => c.id === id);
  const declared = patch.severity ?? existing?.severity;
  if (!declared) return patch;
  return {
    ...patch,
    severity: resolveComment(patch.body, declared).severity,
  };
}

export function deleteDraftComment(prId: number, id: string): void {
  const scope = requireDraftScope(prId);
  requireEditable(scope, id);
  if (!removeComment(scope, id)) {
    throw new Error('Draft comment no longer exists');
  }
}

/**
 * The provider to post through, or the reason we cannot. GitHub needs
 * a head SHA to anchor a review to, and refuses the whole batch
 * without one rather than posting some comments against the wrong
 * commit.
 */
function requirePostVendor(
  vendor: string | undefined,
  headSha: string | undefined
): 'github' | 'azure-devops' {
  if (vendor !== 'github' && vendor !== 'azure-devops') {
    throw new Error(
      vendor ? `Unsupported vendor: ${vendor}` : 'No VCS provider configured'
    );
  }
  if (vendor === 'github' && !headSha) {
    throw new Error('Missing head SHA — refresh pull requests and try again');
  }
  return vendor;
}

/**
 * Post the given drafts (or every draft when `ids` is omitted). The
 * poster claims each one (`posting`), marks it `posted` on success and
 * `draft` on failure so nothing is lost, and skips one the TUI or
 * another window is already posting. Returns how many this call posted.
 */
export async function postDraftComments(
  req: PostDraftsRequest
): Promise<number> {
  const cwd = requireRepo();
  requirePrId(req.prId);
  const config = readConfig(cwd);
  const vendor = requirePostVendor(config.vendor, req.headSha);
  const scope = requireDraftScope(req.prId);
  const all = readComments(scope);
  const wanted = all.filter(
    (c) => c.status === 'draft' && (!req.ids || req.ids.includes(c.id))
  );
  if (wanted.length === 0) return 0;

  const ctx: PostContext = {
    vendor,
    vendorAuth: config.vendorAuth,
    vendorProject: config.vendorProject,
    prId: req.prId,
    headSha: req.headSha,
  };
  // One comment per post call, like the TUI's diff viewer. A batch
  // that dies mid-way would otherwise reset already-live comments back
  // to draft (duplicating them on retry); posting singly bounds any
  // failure to exactly the comment that failed.
  let posted = 0;
  for (const c of wanted) {
    try {
      // A non-COMMENT event (verdict) must ride exactly one review —
      // repeating it per comment would file N approvals on GitHub.
      const done = await postReviewComments(
        [c],
        ctx,
        posted === 0 ? req.event ?? 'COMMENT' : 'COMMENT'
      );
      posted += done.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        posted > 0
          ? `Posted ${posted} of ${wanted.length}, then failed: ${message}`
          : message
      );
    }
  }
  return posted;
}
