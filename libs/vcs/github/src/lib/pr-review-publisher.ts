import {
  freshLedger,
  isVcsError,
  ReviewPublishError,
  type LedgerStore,
  type PublishedReview,
  type RepositoryRef,
  type ReviewItem,
  type ReviewLedger,
  type ReviewSubmission,
} from '@n10/vcs-core';
import {
  ADD_REPLY,
  addThreadMutation,
  DELETE_COMMENT,
  DELETE_REVIEW,
  REVIEW_BY_ID,
  REVIEW_STATE,
  START_REVIEW,
  SUBMIT_REVIEW,
  UPDATE_COMMENT,
} from './pr-review-queries.js';

/**
 * A GitHub review filed the way GitHub files one: a pending review on
 * the reviewed commit, its threads and replies added to it, then one
 * submit with the summary and verdict. Nobody else sees any of it until
 * the submit, so a publication that stops part-way leaves nothing half
 * posted — only the reviewer's own pending review, which the next
 * attempt carries on.
 *
 * Every step is recorded in the ledger before it is sent and after it
 * is answered. A step whose answer was lost is looked for in the
 * pending review (or the review's state) before it is sent again.
 */

type GraphQL = (
  query: string,
  variables: Record<string, string | number>
) => Promise<unknown>;

interface PendingComment {
  id: string;
  body: string;
  path: string;
  replyTo: { id: string } | null;
}

interface PendingReview {
  id: string;
  createdAt: string;
  comments: { nodes: PendingComment[] };
}

interface PullRequestState {
  id: string;
  headRefOid: string;
  pending: PendingReview | null;
}

export async function publishGitHubReview(
  gql: GraphQL,
  repository: RepositoryRef,
  submission: ReviewSubmission,
  store: LedgerStore,
  now: () => number = Date.now
): Promise<PublishedReview> {
  const [owner, repo] = repository.repository.split('/');
  if (!owner || !repo) throw new Error('GitHub project not configured');
  const pr = await readState(gql, owner, repo, submission.prId);
  const run = new Run(gql, store, submission, now);
  // An earlier attempt may have got as far as the submit.
  if (await run.alreadySubmitted(pr.pending)) return run.result();
  if (pr.headRefOid !== submission.head) {
    throw new ReviewPublishError(
      'moved',
      `The pull request has new commits since ${submission.head.slice(
        0,
        7
      )}; review them before submitting`
    );
  }
  await run.openReview(pr);
  await run.dropUnchosen();
  for (const item of submission.items) await run.add(item, pr.pending);
  await run.submit();
  return run.result();
}

async function readState(
  gql: GraphQL,
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestState> {
  const answer = (await gql(REVIEW_STATE, { owner, repo, number })) as {
    data?: {
      repository?: {
        pullRequest?: {
          id: string;
          headRefOid: string;
          reviews: { nodes: PendingReview[] };
        } | null;
      } | null;
    };
  };
  const pr = answer.data?.repository?.pullRequest;
  if (!pr) {
    throw new ReviewPublishError(
      'refused',
      `Pull request #${number} was not found`
    );
  }
  return {
    id: pr.id,
    headRefOid: pr.headRefOid,
    // GitHub shows a reviewer only their own pending review.
    pending: pr.reviews.nodes[0] ?? null,
  };
}

/** One attempt at a publication, over the ledger it resumes. */
class Run {
  private ledger: ReviewLedger;

  constructor(
    private readonly gql: GraphQL,
    private readonly store: LedgerStore,
    private readonly submission: ReviewSubmission,
    now: () => number
  ) {
    const kept = store.read();
    this.ledger = kept ?? freshLedger(submission.head, now());
    this.fresh = () => freshLedger(submission.head, now());
  }

  private readonly fresh: () => ReviewLedger;

  result(): PublishedReview {
    const items: Record<string, string> = {};
    for (const [key, { id }] of Object.entries(this.ledger.added)) {
      items[key] = id;
    }
    return { reviewId: this.ledger.reviewId!, items };
  }

  /**
   * Whether an earlier attempt already submitted the review: its submit
   * was answered, or was lost and the review is no longer pending.
   */
  async alreadySubmitted(pending: PendingReview | null): Promise<boolean> {
    const { reviewId } = this.ledger;
    if (this.ledger.submitted) return true;
    if (!reviewId || pending?.id === reviewId) return false;
    const state = await this.reviewState(reviewId);
    if (state && state !== 'PENDING') {
      this.save({ submitted: true, inFlight: null });
      return true;
    }
    // Gone without being submitted (discarded on GitHub): start over.
    this.ledger = this.fresh();
    this.store.write(this.ledger);
    return false;
  }

  async openReview(pr: PullRequestState): Promise<void> {
    const mine = this.ledger.reviewId;
    if (mine && this.ledger.head !== this.submission.head) {
      // Created against a head the reviewer has since moved past.
      await this.step('discard', () =>
        this.gql(DELETE_REVIEW, { review: mine })
      );
      this.ledger = this.fresh();
      this.store.write(this.ledger);
      pr.pending = null;
    }
    if (this.ledger.reviewId) return;
    if (pr.pending) {
      if (!this.startedHere(pr.pending)) {
        throw new ReviewPublishError(
          'blocked',
          'You have a pending review on GitHub for this pull request. Submit or discard it there first'
        );
      }
      this.save({ reviewId: pr.pending.id, inFlight: null });
      return;
    }
    const answer = (await this.step('review', () =>
      this.gql(START_REVIEW, { pr: pr.id, commit: this.submission.head })
    )) as {
      data: { addPullRequestReview: { pullRequestReview: { id: string } } };
    };
    this.save({
      reviewId: answer.data.addPullRequestReview.pullRequestReview.id,
      inFlight: null,
    });
  }

  async add(item: ReviewItem, pending: PendingReview | null): Promise<void> {
    const done = this.ledger.added[item.key];
    if (done) {
      if (done.body !== item.body) await this.update(item, done.id);
      return;
    }
    if (this.ledger.inFlight === item.key) {
      const found = pending?.comments.nodes.find((c) => sameItem(c, item));
      if (found) return this.record(item, found.id);
    }
    const review = this.ledger.reviewId!;
    const answer = await this.step(item.key, () =>
      item.place.kind === 'reply'
        ? this.gql(ADD_REPLY, {
            review,
            thread: item.place.threadId,
            body: item.body,
          })
        : this.gql(addThreadMutation(item.place), {
            review,
            body: item.body,
            ...threadVariables(item.place),
          })
    );
    this.record(item, commentIdOf(answer));
  }

  /** Comments an earlier attempt added for drafts no longer chosen:
   *  taken out of the pending review, so only what was chosen is filed. */
  async dropUnchosen(): Promise<void> {
    const chosen = new Set(this.submission.items.map((i) => i.key));
    for (const [key, { id }] of Object.entries(this.ledger.added)) {
      if (chosen.has(key)) continue;
      await this.step(`drop:${key}`, () =>
        this.gql(DELETE_COMMENT, { id })
      ).catch((err: unknown) => {
        // Already gone is what was wanted.
        if (!isGone(err)) throw err;
      });
      const added = Object.fromEntries(
        Object.entries(this.ledger.added).filter(([k]) => k !== key)
      );
      this.save({ added, inFlight: null });
    }
  }

  async submit(): Promise<void> {
    // A lost submit that took effect was found by `alreadySubmitted`.
    const review = this.ledger.reviewId!;
    const { event, body } = this.submission;
    await this.step('submit', () =>
      this.gql(SUBMIT_REVIEW, { review, event, body })
    );
    this.save({ submitted: true, inFlight: null });
  }

  private async update(item: ReviewItem, id: string): Promise<void> {
    await this.step(item.key, () =>
      this.gql(UPDATE_COMMENT, { id, body: item.body })
    );
    this.record(item, id);
  }

  private record(item: ReviewItem, id: string): void {
    this.save({
      added: { ...this.ledger.added, [item.key]: { id, body: item.body } },
      inFlight: null,
    });
  }

  private startedHere(pending: PendingReview): boolean {
    return (
      this.ledger.inFlight === 'review' &&
      Date.parse(pending.createdAt) >= this.ledger.startedAt - 1_000
    );
  }

  private async reviewState(id: string): Promise<string | null> {
    const answer = (await this.gql(REVIEW_BY_ID, { id })) as {
      data?: { node?: { state?: string } | null };
    };
    return answer.data?.node?.state ?? null;
  }

  /** Send one step: marked in flight first, cleared when refused. */
  private async step(name: string, send: () => Promise<unknown>) {
    this.save({ inFlight: name });
    try {
      return await send();
    } catch (err) {
      if (isVcsError(err) && err.refused) {
        this.save({ inFlight: null });
        throw new ReviewPublishError('refused', err.message, err);
      }
      throw new ReviewPublishError(
        'unknown',
        'GitHub did not answer; n10 will check what was posted before trying again',
        err
      );
    }
  }

  private save(patch: Partial<ReviewLedger>): void {
    this.ledger = { ...this.ledger, ...patch };
    this.store.write(this.ledger);
  }
}

function isGone(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  return isVcsError(cause) && cause.kind === 'not-found';
}

function sameItem(c: PendingComment, item: ReviewItem): boolean {
  if (c.body !== item.body) return false;
  if (item.place.kind === 'reply') return c.replyTo != null;
  return c.replyTo == null && c.path === item.place.path;
}

function threadVariables(
  place: Exclude<ReviewItem['place'], { kind: 'reply' }>
): Record<string, string | number> {
  if (place.kind === 'file') return { path: place.path };
  const { range } = place;
  const one = range.start === range.end;
  return {
    path: place.path,
    line: range.end,
    side: range.side,
    ...(one ? {} : { startLine: range.start, startSide: range.startSide }),
  };
}

function commentIdOf(answer: unknown): string {
  const data = (answer as { data?: Record<string, unknown> }).data ?? {};
  const reply = data['addPullRequestReviewThreadReply'] as
    | { comment: { id: string } }
    | undefined;
  if (reply) return reply.comment.id;
  const thread = data['addPullRequestReviewThread'] as {
    thread: { comments: { nodes: { id: string }[] } };
  };
  return thread.thread.comments.nodes[0]!.id;
}
