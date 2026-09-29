import type { ReviewLedger, SentPlace } from '@n10/vcs-core';

/**
 * The Azure DevOps threads a review publication writes, from the
 * documented pull request threads API: a thread per line range, file
 * or summary, and a comment for each reply. A line range names its
 * side (`rightFile*` for the new side, `leftFile*` for the old) and the
 * iteration it was read at, so Azure places it on that revision.
 */

export interface IterationContext {
  /** The iteration whose source commit is the reviewed head. */
  iteration: number;
  /** Each changed path's `changeTrackingId` in that iteration. */
  tracking: Map<string, number>;
}

interface AdoPosition {
  line: number;
  offset: number;
}

export interface AdoThreadContext {
  filePath: string;
  rightFileStart?: AdoPosition | null;
  rightFileEnd?: AdoPosition | null;
  leftFileStart?: AdoPosition | null;
  leftFileEnd?: AdoPosition | null;
}

export interface AdoReviewThread {
  id: number;
  threadContext?: AdoThreadContext | null;
  comments?: {
    id: number;
    parentCommentId?: number;
    content?: string;
    commentType?: string | number;
    author?: { id?: string };
  }[];
}

/** A new thread's place: code, a file, or the conversation. */
export type ThreadPlace = Exclude<SentPlace, { kind: 'reply' }>;

/** Where a thread goes; none for the conversation. */
export function threadContext(place: ThreadPlace) {
  if (place.kind === 'conversation') return null;
  const filePath = `/${place.path}`;
  if (place.kind === 'file') return { filePath };
  const { start, end, side } = place.range;
  const at = (line: number) => ({ line, offset: 1 });
  return side === 'RIGHT'
    ? { filePath, rightFileStart: at(start), rightFileEnd: at(end) }
    : { filePath, leftFileStart: at(start), leftFileEnd: at(end) };
}

/** The body of a new thread holding `body`, placed at `place`. */
export function newThread(
  body: string,
  place: ThreadPlace,
  context: IterationContext | null
) {
  const where = threadContext(place);
  const tracking = where && context?.tracking.get(where.filePath);
  return {
    comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
    status: 1,
    ...(where ? { threadContext: where } : {}),
    ...(where && context
      ? {
          pullRequestThreadContext: {
            // Both sides of the head's iteration: equal iterations
            // compare it with the common commit, the diff under review.
            iterationContext: {
              firstComparingIteration: context.iteration,
              secondComparingIteration: context.iteration,
            },
            ...(tracking ? { changeTrackingId: tracking } : {}),
          },
        }
      : {}),
  };
}

/**
 * The viewer's comments saying `sent.body` in `sent.place`: threads
 * they started with that text there, or their replies with that text
 * in that thread. A lost write is the one among them that is neither
 * recorded for another item nor already there when it was sent.
 */
export function lookAlikes(
  threads: AdoReviewThread[],
  sent: Pick<NonNullable<ReviewLedger['sending']>, 'body' | 'place'>,
  me: string
): string[] {
  const { place } = sent;
  if (place.kind === 'reply') {
    const thread = threads.find((t) => String(t.id) === place.threadId);
    return (thread?.comments ?? [])
      .filter(
        (c) =>
          c.author?.id === me &&
          c.content === sent.body &&
          (c.parentCommentId ?? 0) !== 0
      )
      .map((c) => String(c.id));
  }
  const want = JSON.stringify(threadContext(place));
  return threads
    .filter((t) => {
      const first = t.comments?.[0];
      return (
        first?.author?.id === me &&
        first.content === sent.body &&
        JSON.stringify(sameShape(t.threadContext)) === want
      );
    })
    .map((t) => String(t.id));
}

export function findPosted(
  threads: AdoReviewThread[],
  sent: NonNullable<ReviewLedger['sending']>,
  me: string,
  recorded: Set<string>
): string | null {
  const before = new Set(sent.before ?? []);
  return (
    lookAlikes(threads, sent, me).find(
      (id) => !recorded.has(id) && !before.has(id)
    ) ?? null
  );
}

/** A thread's context in the shape `threadContext` builds: Azure
 *  answers with every position, null where there is none. */
function sameShape(c: AdoThreadContext | null | undefined) {
  if (!c) return null;
  const at = (p: AdoPosition | null | undefined) =>
    p ? { line: p.line, offset: p.offset } : undefined;
  const out: Record<string, unknown> = { filePath: c.filePath };
  for (const key of [
    'rightFileStart',
    'rightFileEnd',
    'leftFileStart',
    'leftFileEnd',
  ] as const) {
    const p = at(c[key]);
    if (p) out[key] = p;
  }
  return out;
}
