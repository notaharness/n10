import {
  freshLedger,
  type FiledReview,
  isVcsError,
  ReviewPublishError,
  type LedgerStore,
  type PublishedReview,
  type RepositoryRef,
  type ReviewItem,
  type ReviewLedger,
  type ReviewSubmission,
} from '@n10/vcs-core';
import { findSent, reviewComments, type GraphQL } from './pr-review-match.js';
import {
  readState,
  reviewById,
  type PendingReview,
  type PullRequestState,
} from './pr-review-state.js';
import {
  ADD_REPLY,
  addThreadMutation,
  commentIdOf,
  threadVariables,
  DELETE_COMMENT,
  DELETE_REVIEW,
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
 * is answered. A step whose answer was lost is looked for (in the
 * pending review, or in the review's state) before anything else is
 * sent, so nothing goes out twice on the strength of a guess.
 */

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
  const filed = await run.alreadyFiled(pr.pending);
  if (filed) return run.result(filed);
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
  await run.reconcile();
  await run.dropUnchosen();
  for (const item of submission.items) await run.add(item);
  await run.submit();
  return run.result(null);
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
    this.fresh = () => freshLedger(submission.head, now());
    this.ledger = store.read() ?? this.fresh();
  }

  private readonly fresh: () => ReviewLedger;

  result(resumed: FiledReview | null): PublishedReview {
    const items: Record<string, string> = {};
    for (const [key, { id }] of Object.entries(this.ledger.added)) {
      items[key] = id;
    }
    return { reviewId: this.ledger.reviewId!, items, resumed };
  }

  /**
   * The review an earlier attempt's review became, if it was filed: by
   * that attempt's submit (answered, or lost and no longer pending), or
   * by the reviewer on GitHub. A step still in flight is accounted for
   * against what the filed review holds first.
   */
  async alreadyFiled(
    pending: PendingReview | null
  ): Promise<FiledReview | null> {
    const { reviewId, submitted } = this.ledger;
    if (!reviewId) return null;
    if (!submitted && pending?.id === reviewId) {
      // Still pending: a submit whose answer was lost did not land.
      if (this.ledger.inFlight === 'submit') this.save({ inFlight: null });
      return null;
    }
    const review = await reviewById(this.gql, reviewId);
    if (review && review.state !== 'PENDING') {
      await this.reconcile();
      this.save({ submitted: true, inFlight: null });
      return review;
    }
    // Gone without being submitted (discarded on GitHub): start over.
    this.reset();
    return null;
  }

  /**
   * The pending review to fill: this publication's own, or a new one.
   * One it started on a head the reviewer has since moved past is
   * discarded first; a start whose answer was lost is taken up only
   * when the review found is on the head it asked for and still empty.
   * Any other pending review is the reviewer's own work on GitHub, and
   * is left alone.
   */
  async openReview(pr: PullRequestState): Promise<void> {
    const { head } = this.submission;
    const lost =
      !this.ledger.reviewId && pr.pending && this.startedHere(pr.pending)
        ? pr.pending.id
        : null;
    const mine = this.ledger.reviewId ?? lost;
    if (this.ledger.head !== head) {
      if (mine) {
        await this.step('discard', () =>
          this.gql(DELETE_REVIEW, { review: mine })
        );
      }
      this.reset();
    } else if (mine) {
      if (lost) this.save({ reviewId: lost, inFlight: null });
      return;
    }
    if (pr.pending && pr.pending.id !== mine) {
      throw new ReviewPublishError(
        'blocked',
        'You have a pending review on GitHub for this pull request. Submit or discard it there first'
      );
    }
    const answer = (await this.step('review', () =>
      this.gql(START_REVIEW, { pr: pr.id, commit: head })
    )) as {
      data: { addPullRequestReview: { pullRequestReview: { id: string } } };
    };
    this.save({
      reviewId: answer.data.addPullRequestReview.pullRequestReview.id,
      inFlight: null,
    });
  }

  /**
   * Account for an item step whose answer was lost, before anything
   * else is sent: a comment added (found by what it said and where,
   * among those not already recorded), or one taken out (found gone).
   * A found comment is recorded even when its draft is no longer
   * chosen, so it is then taken out like any other.
   */
  async reconcile(): Promise<void> {
    const { inFlight, sending, reviewId } = this.ledger;
    if (!inFlight || !reviewId || STEPS.has(inFlight)) return;
    const comments = await reviewComments(this.gql, reviewId);
    if (inFlight.startsWith('drop:')) {
      const key = inFlight.slice('drop:'.length);
      const kept = comments.some((c) => c.id === this.ledger.added[key]?.id);
      this.save({
        inFlight: null,
        added: kept ? this.ledger.added : without(this.ledger.added, key),
      });
      return;
    }
    const known = new Set(Object.values(this.ledger.added).map((a) => a.id));
    const found = sending
      ? await findSent(this.gql, comments, sending, known)
      : undefined;
    const added = found
      ? { ...this.ledger.added, [inFlight]: { id: found.id, body: found.body } }
      : this.ledger.added;
    this.save({ inFlight: null, sending: null, added });
  }

  async add(item: ReviewItem): Promise<void> {
    const done = this.ledger.added[item.key];
    if (done) {
      if (done.body !== item.body) await this.update(item, done.id);
      return;
    }
    const review = this.ledger.reviewId!;
    this.save({ sending: { body: item.body, place: item.place } });
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
      this.save({ added: without(this.ledger.added, key), inFlight: null });
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
      sending: null,
    });
  }

  /** Its own start whose answer was lost: the reviewer's, on the head
   *  it asked for, and still empty. One with comments in it was filled
   *  on GitHub, so it is the reviewer's work there, not this start. */
  private startedHere(pending: PendingReview): boolean {
    return (
      this.ledger.inFlight === 'review' &&
      pending.commit?.oid === this.ledger.head &&
      pending.comments.totalCount === 0
    );
  }

  private reset(): void {
    this.ledger = this.fresh();
    this.store.write(this.ledger);
  }

  /** Send one step: marked in flight first, cleared when refused. */
  private async step(name: string, send: () => Promise<unknown>) {
    this.save({ inFlight: name });
    const item = this.submission.items.some((i) => i.key === name)
      ? name
      : null;
    try {
      return await send();
    } catch (err) {
      if (isVcsError(err) && err.refused) {
        this.save({ inFlight: null, sending: null });
        throw new ReviewPublishError('refused', err.message, {
          cause: err,
          item,
        });
      }
      throw new ReviewPublishError(
        'unknown',
        'GitHub did not answer; n10 will check what was posted before trying again',
        { cause: err, item }
      );
    }
  }

  private save(patch: Partial<ReviewLedger>): void {
    this.ledger = { ...this.ledger, ...patch };
    this.store.write(this.ledger);
  }
}

/** Steps that are not an item's; each is accounted for where it is sent. */
const STEPS = new Set(['review', 'discard', 'submit']);

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

function isGone(err: unknown): boolean {
  const cause = err instanceof Error ? err.cause : undefined;
  return isVcsError(cause) && cause.kind === 'not-found';
}
