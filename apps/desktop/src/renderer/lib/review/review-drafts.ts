import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type {
  DraftTarget,
  PullRequestRef,
  ReviewDraft,
  ReviewDrafts,
} from '../../../host/contract.js';
import { assertAnswerFor } from '../data/pr-snapshot-query.js';
import { keys } from '../data/query-keys.js';
import { useRepo } from '../repo-context.js';
import { errorMessage } from '../utils.js';

/**
 * The reviewer's own writing, kept as they type it. Text is saved on
 * this machine a moment after each change, and at once when the
 * composer closes or leaves the screen, so a reply survives a scroll,
 * a tab or repository switch and a restart. It is never sent to the
 * provider from here: publishing stays an explicit act.
 */

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'failed'; error: string };

export interface DurableDraft {
  body: string;
  setBody: (body: string) => void;
  save: SaveState;
  /** Save now, rather than after the pause. */
  flush: () => void;
  /** Save the text again after a failed save. */
  retry: () => void;
  /** Remove the stored draft and clear the text. Never rejects: a
   *  failure is reported as a toast. */
  discard: () => Promise<void>;
  /** False when there is no pull request identity to save against;
   *  the text then lives only as long as the composer. */
  durable: boolean;
}

const SAVE_DELAY_MS = 400;

export function draftIdOf(target: DraftTarget): string {
  return target.kind === 'reply' ? `reply:${target.threadId}` : target.kind;
}

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

/** Put `draft` (or its absence) into the cached list for `id`. */
function patchCache(
  client: QueryClient,
  key: readonly unknown[],
  id: string,
  draft: ReviewDraft | null
): void {
  client.setQueryData<ReviewDrafts>(key, (old) => {
    if (!old) return old;
    const others = old.drafts.filter((d) => d.id !== id);
    return { ...old, drafts: draft ? [...others, draft] : others };
  });
}

/** What a write needs, as of the last render. */
interface WriteContext {
  client: QueryClient;
  ref: PullRequestRef | null;
  viewer: string | null;
  target: DraftTarget;
  key: readonly unknown[];
}

export function useReviewDraft(
  ref: PullRequestRef | null,
  target: DraftTarget
): DurableDraft {
  const { repo } = useRepo();
  const client = useQueryClient();
  const drafts = useReviewDrafts(ref);
  const id = draftIdOf(target);
  const stored = drafts.data?.drafts.find((d) => d.id === id) ?? null;

  // What the reader has typed since this composer mounted; until then
  // the stored text is the text.
  const [typed, setTyped] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const pending = useRef<{ body: string; timer: number } | null>(null);
  const latest = useRef(0);
  // The ref and target are rebuilt on every render; the writes read
  // them here so their own identity, and the unmount flush, stay put.
  const context = useRef<WriteContext | null>(null);
  useEffect(() => {
    context.current = {
      client,
      ref,
      viewer: repo.viewer,
      target,
      key: keys.reviewDrafts(repo.cwd, ref, repo.viewer),
    };
  });

  const write = useCallback((body: string, quiet: boolean) => {
    const ctx = context.current;
    if (!ctx?.ref) return;
    const seq = ++latest.current;
    const id = draftIdOf(ctx.target);
    window.n10
      .saveReviewDraft({
        ref: ctx.ref,
        viewer: ctx.viewer,
        target: ctx.target,
        body,
      })
      .then((draft) => {
        patchCache(ctx.client, ctx.key, id, draft);
        if (!quiet && seq === latest.current) {
          setSave({ kind: 'saved', at: Date.now() });
        }
      })
      .catch((err: unknown) => {
        if (quiet)
          toast.error(`Couldn't save your draft: ${errorMessage(err)}`);
        else if (seq === latest.current) {
          setSave({ kind: 'failed', error: errorMessage(err) });
        }
      });
  }, []);

  const flushWith = useCallback(
    (quiet: boolean) => {
      const next = pending.current;
      if (!next) return;
      window.clearTimeout(next.timer);
      pending.current = null;
      write(next.body, quiet);
    },
    [write]
  );

  const setBody = (body: string) => {
    setTyped(body);
    if (!ref) return;
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = {
      body,
      timer: window.setTimeout(() => flushWith(false), SAVE_DELAY_MS),
    };
    setSave({ kind: 'saving' });
  };

  // Leaving the screen saves what is waiting. Nobody is left to show a
  // failure inline, so it is a toast.
  useEffect(() => () => flushWith(true), [flushWith]);

  const discard = async () => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    latest.current += 1;
    setTyped('');
    setSave({ kind: 'idle' });
    if (!ref) return;
    try {
      await window.n10.discardReviewDraft({ ref, viewer: repo.viewer, id });
      patchCache(
        client,
        keys.reviewDrafts(repo.cwd, ref, repo.viewer),
        id,
        null
      );
    } catch (err) {
      toast.error(`Couldn't discard your draft: ${errorMessage(err)}`);
    }
  };

  return {
    body: typed ?? stored?.body ?? '',
    setBody,
    save,
    flush: () => flushWith(false),
    retry: () => {
      flushWith(false);
      if (save.kind === 'failed') {
        setSave({ kind: 'saving' });
        write(typed ?? stored?.body ?? '', false);
      }
    },
    discard,
    durable: ref != null,
  };
}
