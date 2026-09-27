import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type {
  DraftTarget,
  PullRequestRef,
  ReviewDraft,
  ReviewDrafts,
} from '../../../host/contract.js';
import { assertAnswerFor } from '../data/pr-snapshot-query.js';
import { readError } from '../data/read-state.js';
import { keys, queryClient } from '../data/query-keys.js';
import { useRepo } from '../repo-context.js';
import {
  DraftEdits,
  editKey,
  sameTarget,
  withDraft,
  type SaveRequest,
  type SaveState,
} from './draft-edits.js';

const isEditable = (d: ReviewDraft) =>
  d.publication.state === 'unpublished' || d.publication.state === 'failed';

/**
 * The reviewer's own writing, kept as they type it: saved on this
 * machine a moment after each change, so a reply survives a scroll, a
 * tab or repository switch and a restart. What is typed but not yet
 * kept lives in `draft-edits.ts`, outside any component. Nothing here
 * publishes: sending stays an explicit act.
 */

export type { SaveState } from './draft-edits.js';

export interface DurableDraft {
  /** The pull request it is written on; null when there is none. */
  ref: PullRequestRef | null;
  body: string;
  setBody: (body: string) => void;
  save: SaveState;
  /** Save now, rather than after the pause. */
  flush: () => void;
  /** Save the text again after a failed save. */
  retry: () => void;
  /** Remove the stored draft and clear the text, with an Undo that
   *  brings back `text` (by default what is in the box); told when the
   *  text comes back. Never rejects: a failure is a toast. */
  discard: (onUndo?: () => void, text?: string) => Promise<void>;
  /** The same, silently, for text that was sent. */
  clear: () => Promise<void>;
  /** The stored drafts have not been read yet; editing waits, so the
   *  first save cannot replace a draft nobody has seen. */
  loading: boolean;
  /** Why the stored drafts could not be read, when they could not. */
  readError: string | null;
  /** False when there is no pull request identity to save against;
   *  the text then lives only as long as the renderer. */
  durable: boolean;
}

function patchCache(req: SaveRequest, draft: ReviewDraft | null): void {
  queryClient.setQueryData<ReviewDrafts>(
    keys.reviewDrafts(req.cwd, req.ref, req.viewer),
    (old) => {
      if (!old) return old;
      return { ...old, drafts: withDraft(old.drafts, req.target, draft) };
    }
  );
}

const edits = new DraftEdits({
  save: ({ ref, viewer, target, body }) =>
    window.n10
      .saveReviewDraft({ ref, viewer, target, body })
      .catch((err: unknown) => {
        // The host's sentence, without Electron's transport wrapper.
        throw new Error(readError(err));
      }),
  saved: patchCache,
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id),
});

// A reload or quit does not wait out the pause; the saves it starts
// here still reach the host, which does not unload with the page.
window.addEventListener('pagehide', () => edits.flushAll());
// Text whose save failed exists only in this page: leaving asks first
// (the host shows the question; see main/unsaved-guard.ts).
window.addEventListener('beforeunload', (e) => {
  if (edits.hasFailed()) e.preventDefault();
});

async function loadDrafts(
  ref: PullRequestRef,
  viewer: string | null
): Promise<ReviewDrafts> {
  const answer = await window.n10.listReviewDrafts({ ref, viewer });
  assertAnswerFor(ref, viewer, answer);
  return answer;
}

export function useReviewDrafts(ref: PullRequestRef | null) {
  const { repo } = useRepo();
  return useQuery({
    queryKey: keys.reviewDrafts(repo.cwd, ref, repo.viewer),
    queryFn: () => loadDrafts(ref!, repo.viewer),
    enabled: ref != null,
    // Only this renderer writes them; every write updates the entry.
    staleTime: Infinity,
  });
}

type InlineDraftTarget = Extract<DraftTarget, { kind: 'inline' }>;
const NO_TARGETS: InlineDraftTarget[] = [];
const inlineTargetsOf = (d: ReviewDrafts): InlineDraftTarget[] =>
  d.drafts.flatMap((x) =>
    x.target.kind === 'inline' && isEditable(x) && x.body.trim()
      ? [x.target]
      : []
  );

/**
 * Where the reviewer's comments on code are: the targets of the stored
 * drafts a card can show. The answer is structurally shared, so a save
 * that changes only a body leaves it the same array and the diff that
 * places them is not rebuilt while someone types.
 */
export function useInlineDraftTargets(
  ref: PullRequestRef | null
): InlineDraftTarget[] {
  const { repo } = useRepo();
  const { data } = useQuery({
    queryKey: keys.reviewDrafts(repo.cwd, ref, repo.viewer),
    queryFn: () => loadDrafts(ref!, repo.viewer),
    enabled: ref != null,
    staleTime: Infinity,
    select: inlineTargetsOf,
  });
  return data ?? NO_TARGETS;
}

/** Placeholder while there is no ref: the text is kept in memory only. */
const LOCAL: PullRequestRef = {
  provider: 'local',
  host: '',
  repository: '',
  number: 0,
};

export function useReviewDraft(
  ref: PullRequestRef | null,
  target: DraftTarget
): DurableDraft {
  const { repo } = useRepo();
  const drafts = useReviewDrafts(ref);
  const scope = {
    cwd: repo.cwd,
    ref: ref ?? LOCAL,
    viewer: repo.viewer,
    target,
  };
  const key = editKey(scope);
  const edit = useSyncExternalStore(edits.subscribe, () => edits.get(key));
  // A draft being posted, or already posted, is not text to edit.
  const stored =
    drafts.data?.drafts.find(
      (d) => sameTarget(d.target, target) && isEditable(d)
    ) ?? null;
  const body = edit?.text ?? stored?.body ?? '';

  const setBody = (text: string) => {
    if (ref) edits.type(key, { ...scope, body: text });
    else edits.local(key, { ...scope, body: text });
  };

  const offerUndo = (text: string, onUndo?: () => void) =>
    toast('Draft discarded', {
      action: {
        label: 'Undo',
        onClick: () => {
          setBody(text);
          onUndo?.();
        },
      },
    });

  const remove = (
    undoable: boolean,
    onUndo?: () => void,
    text = body
  ): Promise<void> => {
    edits.forget(key);
    if (!ref) return Promise.resolve();
    // By target, after any save still in flight for it: IPC answers in
    // order, so a first save that lands late is removed too.
    return window.n10
      .discardReviewDraft({ ref, viewer: repo.viewer, target })
      .then(
        () => {
          patchCache({ ...scope, body: '' }, null);
          if (undoable && text.trim()) offerUndo(text, onUndo);
        },
        (err: unknown) => {
          toast.error(`Couldn't discard your draft: ${readError(err)}`);
        }
      );
  };

  return {
    ref,
    body,
    setBody,
    save: edit?.save ?? { kind: 'idle' },
    flush: () => edits.flush(key),
    retry: () => edits.retry(key),
    discard: (onUndo, text) => remove(true, onUndo, text),
    clear: () => remove(false),
    loading: ref != null && drafts.isPending,
    readError: drafts.error ? readError(drafts.error) : null,
    durable: ref != null,
  };
}
