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
  id: string;
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
  const { id } = value as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('Invalid draft id');
  }
  return { ...base, id };
}

function parseTarget(value: unknown): DraftTarget {
  const target = (value ?? {}) as Record<string, unknown>;
  if (target['kind'] === 'general' || target['kind'] === 'summary') {
    return { kind: target['kind'] };
  }
  const threadId = target['threadId'];
  if (
    target['kind'] === 'reply' &&
    typeof threadId === 'string' &&
    threadId.length > 0
  ) {
    return { kind: 'reply', threadId };
  }
  throw new TypeError('Invalid draft target');
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
 * Store `body` as the draft for `target`, creating it if needed. An
 * empty body removes the draft: there is nothing left to keep. A draft
 * that may already have been sent is not rewritten.
 */
export function saveReviewDraft(
  req: SaveDraftRequest,
  src: DraftSources
): ReviewDraft | null {
  const viewer = assertSameContext(req, src);
  const dir = dirOf(src);
  const file = readDraftFile(dir, req.ref, viewer);
  const id = draftId(req.target);
  const existing = file.drafts.find((d) => d.id === id);
  if (existing && !isEditable(existing)) {
    throw new Error('This draft is being published and cannot change now');
  }
  const others = file.drafts.filter((d) => d.id !== id);
  if (req.body === '') {
    if (existing) writeDraftFile(dir, withRef(file, req.ref, others));
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
  writeDraftFile(dir, withRef(file, req.ref, [...others, draft]));
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
  const existing = file.drafts.find((d) => d.id === req.id);
  if (!existing) return;
  if (existing.publication.state === 'publishing') {
    throw new Error(
      'This draft is being published and cannot be discarded now'
    );
  }
  writeDraftFile(
    dir,
    withRef(
      file,
      req.ref,
      file.drafts.filter((d) => d.id !== req.id)
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
