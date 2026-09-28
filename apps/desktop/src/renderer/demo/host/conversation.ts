import type {
  Capability,
  ConversationActor,
  ConversationComment,
  ConversationEvent,
  ConversationThread,
  Coverage,
  PullRequestConversation,
  PullRequestInfo,
  PullRequestReviewer,
  RemoteCommentReply,
  RemoteCommentThread,
  ReviewSummary,
} from '@n10/vcs-core';
import { isOid, type PullRequestRef } from '@n10/vcs-core/pr-details';
import { VIEWER } from '../data/identity.js';

/**
 * A demo pull request's conversation, as GitHub's read would describe
 * it: the threads and comments the demo's review host holds, so a reply
 * or a resolve in the diff shows here too, each reviewer's verdict as
 * a submitted review, and the events that led up to them.
 */

const SUPPORTED: Capability = { state: 'supported' };

function forbidden(what: string): Capability {
  return { state: 'forbidden', reason: `GitHub does not let you ${what}` };
}

/** GitHub names people by login alone. */
function actor(login: string): ConversationActor {
  return { identifier: login, displayName: login, id: null, kind: 'user' };
}

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

function complete(loaded: number): Coverage {
  return { loaded, total: loaded, complete: true };
}

function comment(
  c: RemoteCommentReply,
  url: string,
  thread: { replyTo: string | null; reviewId: string | null }
): ConversationComment {
  const own = c.author === VIEWER;
  return {
    id: c.id,
    author: actor(c.author),
    source: c.body,
    body: c.body,
    kind: 'text',
    deleted: false,
    createdAt: c.createdAt,
    editedAt: null,
    minimized: null,
    pending: false,
    ...thread,
    url,
    capabilities: {
      edit: own ? SUPPORTED : forbidden('edit this comment'),
      delete: own ? SUPPORTED : forbidden('delete this comment'),
    },
  };
}

/**
 * The excerpt GitHub keeps with a line thread: its hunk from the header
 * down to the commented line, on the new side.
 */
export function hunkTo(section: string, line: number): string | null {
  const lines = section.split('\n');
  let header = -1;
  let at = 0;
  for (const [i, text] of lines.entries()) {
    const start = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (start) {
      header = i;
      at = Number(start[1]) - 1;
    } else if (header >= 0 && !text.startsWith('-')) {
      at += 1;
      if (at === line) return lines.slice(header, i + 1).join('\n');
    }
  }
  return null;
}

/** The review a reviewer's thread was part of: the one their verdict
 *  was submitted with. */
const reviewIdOf = (pr: PullRequestInfo, author: string) =>
  `PRR_demo_${pr.id}_${author}`;

function threadOf(
  t: RemoteCommentThread,
  pr: PullRequestInfo,
  hunk: string | null
): ConversationThread {
  const root = t.comments[0];
  const reviewed = pr.reviewers?.some((r) => r.identifier === root?.author);
  const range =
    t.lineEnd == null
      ? null
      : {
          startSide: t.side,
          start: t.lineStart ?? t.lineEnd,
          side: t.side,
          end: t.lineEnd,
        };
  return {
    id: t.id,
    scope: range ? 'line' : 'file',
    anchor: {
      path: t.file ?? '',
      current: range,
      original: range,
      originalPath: null,
      originalCommit: isOid(pr.headSha) ? pr.headSha : null,
      iterations: null,
      diffHunk: hunk,
    },
    isOutdated: t.isOutdated,
    status: {
      resolved: t.isResolved,
      native: t.isResolved ? 'resolved' : 'unresolved',
      // The demo's agent resolves threads as the viewer.
      resolvedBy: t.isResolved ? actor(VIEWER) : null,
    },
    comments: t.comments.map((c, i) =>
      comment(c, `${pr.url}#discussion_${t.id}`, {
        replyTo: i === 0 ? null : root?.id ?? null,
        reviewId:
          i === 0 && root && reviewed ? reviewIdOf(pr, root.author) : null,
      })
    ),
    coverage: complete(t.comments.length),
    capabilities: { reply: SUPPORTED, resolve: SUPPORTED },
  };
}

const VERDICT: Partial<
  Record<PullRequestReviewer['decision'], ReviewSummary['state']>
> = { approved: 'approved', 'changes-requested': 'changes-requested' };

const NATIVE: Record<string, string> = {
  approved: 'APPROVED',
  'changes-requested': 'CHANGES_REQUESTED',
};

/** A reviewer's verdict as the review that gave it, submitted with the
 *  threads they started. */
function reviewsOf(
  pr: PullRequestInfo,
  threads: readonly RemoteCommentThread[]
): ReviewSummary[] {
  return (pr.reviewers ?? []).flatMap((r) => {
    const state = VERDICT[r.decision];
    if (!state) return [];
    const theirs = threads.filter(
      (t) => t.comments[0]?.author === r.identifier
    );
    const last = theirs
      .map((t) => t.comments[0]?.createdAt ?? '')
      .sort()
      .at(-1);
    return [
      {
        id: reviewIdOf(pr, r.identifier),
        author: actor(r.identifier),
        state,
        native: NATIVE[state] ?? state,
        source: '',
        body: '',
        submittedAt: last || ago(30),
        commit: isOid(pr.headSha) ? pr.headSha : null,
        commentCount: theirs.length,
        minimized: null,
        url: `${pr.url}#pullrequestreview-${r.identifier}`,
      },
    ];
  });
}

/** The head commit, and a request to each reviewer after it. */
function eventsOf(pr: PullRequestInfo): ConversationEvent[] {
  const author = actor(pr.createdByIdentifier);
  const head: ConversationEvent[] = isOid(pr.headSha)
    ? [
        {
          id: `commit_${pr.headSha}`,
          kind: 'commit',
          actor: author,
          at: ago(90),
          native: 'PullRequestCommit',
          commit: pr.headSha,
          headline: pr.title,
          authorName: null,
        },
      ]
    : [];
  const requests = (pr.reviewers ?? []).map(
    (r): ConversationEvent => ({
      id: `request_${pr.id}_${r.identifier}`,
      kind: 'review-requested',
      actor: author,
      at: ago(85),
      native: 'ReviewRequestedEvent',
      reviewer: { kind: 'user', name: r.displayName, handle: r.identifier },
    })
  );
  return [...head, ...requests];
}

export function demoConversation(
  pr: PullRequestInfo,
  ref: PullRequestRef,
  held: {
    threads: RemoteCommentThread[];
    generalComments: RemoteCommentThread[];
  },
  section: (file: string) => Promise<string>
): Promise<PullRequestConversation> {
  return Promise.all(
    held.threads.map(async (t) => {
      const hunk =
        t.file && t.lineEnd != null
          ? hunkTo(await section(t.file), t.lineEnd)
          : null;
      return threadOf(t, pr, hunk);
    })
  ).then((threads) => {
    // A GitHub conversation comment stands alone: an answer is another.
    const comments = held.generalComments.flatMap((t) =>
      t.comments.map((c) =>
        comment(c, `${pr.url}#issuecomment-${c.id}`, {
          replyTo: null,
          reviewId: null,
        })
      )
    );
    const reviews = reviewsOf(pr, held.threads);
    const events = eventsOf(pr);
    const threadComments = threads.reduce((n, t) => n + t.comments.length, 0);
    return {
      ref,
      threads,
      comments,
      reviews,
      events,
      coverage: {
        threads: complete(threads.length),
        threadComments: complete(threadComments),
        comments: complete(comments.length),
        reviews: complete(reviews.length),
        events: complete(events.length),
      },
    };
  });
}
