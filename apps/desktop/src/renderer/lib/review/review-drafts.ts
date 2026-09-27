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
import { keys, queryClient } from '../data/query-keys.js';
import { useRepo } from '../repo-context.js';
import { errorMessage } from '../utils.js';
import {
  DraftEdits,
  editKey,
  sameTarget,
  type SaveRequest,
  type SaveState,
} from './draft-edits.js';

/**
 * The reviewer's own writing, kept as they type it: saved on this
 * machine a moment after each change, so a reply survives a scroll, a
 * tab or repository switch and a restart. What is typed but not yet
 * kept lives in `draft-edits.ts`, outside any component. Nothing here
 * publishes: sending stays an explicit act.
 */

export type { SaveState } from './draft-edits.js';

export interface DurableDraft {
  body: string;
  setBody: (body: string) => void;
  save: SaveState;
  /** Save now, rather than after the pause. */
  flush: () => void;
  /** Save the text again after a failed save. */
  retry: () => void;
  /** Remove the stored draft and clear the text, with an Undo. Never
   *  rejects: a failure is reported as a toast. */
  discard: () => Promise<void>;
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
      const others = old.drafts.filter(
        (d) => !sameTarget(d.target, req.target)
      );
      return { ...old, drafts: draft ? [...others, draft] : others };
    }
  );
}

const edits = new DraftEdits({
  save: ({ ref, viewer, target, body }) =>
    window.n10.saveReviewDraft({ ref, viewer, target, body }),
  saved: patchCache,
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id),
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
  const stored =
    drafts.data?.drafts.find((d) => sameTarget(d.target, target)) ?? null;
  const body = edit?.text ?? stored?.body ?? '';

  const setBody = (text: string) => {
    if (ref) edits.type(key, { ...scope, body: text });
    else edits.local(key, { ...scope, body: text });
  };

  const offerUndo = (text: string) =>
    toast('Draft discarded', {
      action: { label: 'Undo', onClick: () => setBody(text) },
    });

  const remove = (undoable: boolean): Promise<void> => {
    const text = body;
    edits.forget(key);
    if (!ref) return Promise.resolve();
    // By target, after any save still in flight for it: IPC answers in
    // order, so a first save that lands late is removed too.
    return window.n10
      .discardReviewDraft({ ref, viewer: repo.viewer, target })
      .then(
        () => {
          patchCache({ ...scope, body: '' }, null);
          if (undoable && text.trim()) offerUndo(text);
        },
        (err: unknown) => {
          toast.error(`Couldn't discard your draft: ${errorMessage(err)}`);
        }
      );
  };

  return {
    body,
    setBody,
    save: edit?.save ?? { kind: 'idle' },
    flush: () => edits.flush(key),
    retry: () => edits.retry(key),
    discard: () => remove(true),
    clear: () => remove(false),
    loading: ref != null && drafts.isPending,
    readError: drafts.error ? errorMessage(drafts.error) : null,
    durable: ref != null,
  };
}
