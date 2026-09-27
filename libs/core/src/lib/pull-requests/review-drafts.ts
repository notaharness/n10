import type { PullRequestRef } from '@n10/vcs-core';
import {
  assertSameContext,
  parseSnapshotRequest,
  type SnapshotSources,
} from './pr-snapshot.js';
import {
  defaultDraftDir,
  readDraftFile,
  writeDraftFile,
  type DraftFile,
} from './review-draft-store.js';
import {
  draftId,
  isEditable,
  parseTarget,
  type DraftTarget,
  type ReviewDraft,
} from './review-draft-types.js';

/**
 * A reviewer's private drafts, read and written by identity: which pull
 * request, as which account. Every operation is refused unless both are
 * the ones open now, and the account is the configured one, never one
 * the caller names — account B cannot reach account A's drafts by
 * asking for them.
 */

export interface DraftsRequest {
  ref: PullRequestRef;
  /** The account the caller last saw; a different one now is refused. */
  viewer: string | null;
}

export interface SaveDraftRequest extends DraftsRequest {
  target: DraftTarget;
  body: string;
}

export interface DiscardDraftRequest extends DraftsRequest {
  target: DraftTarget;
}

export interface ReviewDrafts {
  ref: PullRequestRef;
  viewer: string | null;
  drafts: ReviewDraft[];
}

export type DraftSources = Pick<SnapshotSources, 'repository' | 'viewer'> & {
  /** Where the files live; `~/.n10/review-drafts` by default. */
  dir?: string;
  now?: () => number;
};

/** Longer than either provider accepts in one comment. */
const MAX_BODY = 262_144;

export function parseDraftsRequest(value: unknown): DraftsRequest {
  const { ref, viewer } = parseSnapshotRequest(value);
  if (viewer === undefined) throw new TypeError('Missing viewer');
  return { ref, viewer };
}

export function parseSaveDraftRequest(value: unknown): SaveDraftRequest {
  const base = parseDraftsRequest(value);
  const { target, body } = value as Record<string, unknown>;
  if (typeof body !== 'string' || body.length > MAX_BODY) {
    throw new TypeError('Invalid draft body');
  }
  return { ...base, target: parseTarget(target), body };
}

export function parseDiscardDraftRequest(value: unknown): DiscardDraftRequest {
  const base = parseDraftsRequest(value);
  const { target } = value as Record<string, unknown>;
  return { ...base, target: parseTarget(target) };
}

export function listReviewDrafts(
  req: DraftsRequest,
  src: DraftSources
): ReviewDrafts {
  const viewer = assertSameContext(req, src);
  const { drafts } = readDraftFile(dirOf(src), req.ref, viewer);
  return { ref: req.ref, viewer, drafts };
}

/**
 * Why a draft cannot change now, if it cannot: an attempt to post it
 * is in flight, or one ended without an answer and must be looked for
 * before the text can change or go.
 */
function locked(draft: ReviewDraft | undefined): string | null {
  switch (draft?.publication.state) {
    case 'publishing':
      return 'This draft is being posted and cannot change now';
    case 'unknown':
      return 'This draft may already have been posted; n10 has to check before it can change';
    default:
      return null;
  }
}

/**
 * Store `body` as the draft for `target`, creating it if needed. An
 * empty body removes the draft: there is nothing left to keep. A draft
 * that may already have been sent is not rewritten; one that was
 * published is spent, and new text for its target starts a new draft.
 */
export function saveReviewDraft(
  req: SaveDraftRequest,
  src: DraftSources
): ReviewDraft | null {
  const viewer = assertSameContext(req, src);
  const dir = dirOf(src);
  const file = readDraftFile(dir, req.ref, viewer);
  const id = draftId(req.target);
  const found = file.drafts.find((d) => d.id === id);
  const reason = locked(found);
  if (reason) throw new Error(reason);
  const existing = found && isEditable(found) ? found : undefined;
  const others = file.drafts.filter((d) => d.id !== id);
  if (req.body === '') {
    if (found) writeDraftFile(dir, withRef(file, req.ref, others));
    return null;
  }
  const now = (src.now ?? Date.now)();
  const draft: ReviewDraft = existing
    ? { ...existing, body: req.body, updatedAt: now }
    : {
        id,
        target: req.target,
        body: req.body,
        createdAt: now,
        updatedAt: now,
        publication: { state: 'unpublished' },
      };
  // In place, so drafts keep the order they were started in.
  const drafts = found
    ? file.drafts.map((d) => (d.id === id ? draft : d))
    : [...file.drafts, draft];
  writeDraftFile(dir, withRef(file, req.ref, drafts));
  return draft;
}

/** Remove a draft. One already gone is not an error. */
export function discardReviewDraft(
  req: DiscardDraftRequest,
  src: DraftSources
): void {
  const viewer = assertSameContext(req, src);
  const dir = dirOf(src);
  const file = readDraftFile(dir, req.ref, viewer);
  const id = draftId(req.target);
  const existing = file.drafts.find((d) => d.id === id);
  if (!existing) return;
  const reason = locked(existing);
  if (reason) throw new Error(reason);
  writeDraftFile(
    dir,
    withRef(
      file,
      req.ref,
      file.drafts.filter((d) => d.id !== id)
    )
  );
}

/** The file with `drafts`, keeping the repository id once one is known. */
function withRef(
  file: DraftFile,
  ref: PullRequestRef,
  drafts: ReviewDraft[]
): DraftFile {
  return { ...file, ref: ref.id ? ref : file.ref, drafts };
}

function dirOf(src: DraftSources): string {
  return src.dir ?? defaultDraftDir();
}
