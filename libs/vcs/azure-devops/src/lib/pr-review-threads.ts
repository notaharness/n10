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
            iterationContext: {
              firstComparingIteration: 1,
              secondComparingIteration: context.iteration,
            },
            ...(tracking ? { changeTrackingId: tracking } : {}),
          },
        }
      : {}),
  };
}

/**
 * What a lost write put on the pull request, found by what it said,
 * who said it and where: a thread the viewer started with that text in
 * that place, or their reply with that text in that thread. Ids already
 * recorded for other items are passed over.
 */
export function findPosted(
  threads: AdoReviewThread[],
  sent: NonNullable<ReviewLedger['sending']>,
  me: string,
  recorded: Set<string>
): string | null {
  const { place } = sent;
  if (place.kind === 'reply') {
    const thread = threads.find((t) => String(t.id) === place.threadId);
    const reply = (thread?.comments ?? []).find(
      (c) =>
        c.author?.id === me &&
        c.content === sent.body &&
        (c.parentCommentId ?? 0) !== 0 &&
        !recorded.has(String(c.id))
    );
    return reply ? String(reply.id) : null;
  }
  const want = JSON.stringify(threadContext(place));
  const thread = threads.find((t) => {
    const first = t.comments?.[0];
    return (
      !recorded.has(String(t.id)) &&
      first?.author?.id === me &&
      first.content === sent.body &&
      JSON.stringify(sameShape(t.threadContext)) === want
    );
  });
  return thread ? String(thread.id) : null;
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
