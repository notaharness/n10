import {
  freshLedger,
  isVcsError,
  ReviewPublishError,
  type LedgerStore,
  type PublishedReview,
  type ReviewEvent,
  type ReviewLedger,
  type ReviewSubmission,
  type SentPlace,
} from '@n10/vcs-core';
import {
  findPosted,
  lookAlikes,
  newThread,
  type AdoReviewThread,
  type IterationContext,
  type ThreadPlace,
} from './pr-review-threads.js';

/**
 * A review filed on Azure DevOps the way Azure has one: each chosen
 * comment as a thread or reply, the summary as a thread on the
 * conversation, and then the reviewer's vote. Azure shows each comment
 * as soon as it is written and has no grouped review, so a publication
 * that stops part-way leaves what it posted posted (reported in the
 * error's `posted`) and casts no vote. The next attempt sends only what
 * is left.
 *
 * Every step is recorded in the ledger before it is sent and after it
 * is answered. A comment whose answer was lost is looked for among the
 * pull request's threads before anything else is sent. The vote is a
 * PUT of the reviewer's own vote, so sending it again is the same vote.
 */

/** The repository's REST API, relative to `_apis/git/repositories/<repo>/`. */
export interface AdoReviewApi {
  get<T>(path: string): Promise<T>;
  send<T>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T>;
  /** The authenticated user's identity id. */
  me(): Promise<string>;
}

/** Azure's vote for each verdict it has; `COMMENT` casts none. */
const VOTES: Partial<Record<ReviewEvent, number>> = {
  APPROVE: 10,
  APPROVE_WITH_SUGGESTIONS: 5,
  RESET_VOTE: 0,
  WAIT_FOR_AUTHOR: -5,
  REJECT: -10,
};

const V = 'api-version=7.1';

export async function publishAzureReview(
  api: AdoReviewApi,
  submission: ReviewSubmission,
  store: LedgerStore
): Promise<PublishedReview> {
  if (submission.event !== 'COMMENT' && !(submission.event in VOTES)) {
    throw new ReviewPublishError(
      'refused',
      'Azure DevOps votes Approve, Approve with suggestions, Wait for author or Reject; it has no Request changes'
    );
  }
  const pr = await api.get<{ lastMergeSourceCommit?: { commitId?: string } }>(
    `pullrequests/${submission.prId}?${V}`
  );
  if (pr.lastMergeSourceCommit?.commitId !== submission.head) {
    throw new ReviewPublishError(
      'moved',
      `The pull request has new commits since ${submission.head.slice(
        0,
        7
      )}; review them before submitting`
    );
  }
  const run = new Run(api, store, submission, await api.me());
  try {
    await run.reconcile();
    for (const item of submission.items) {
      if (item.place.kind === 'reply')
        await run.reply(item.key, item.body, item.place.threadId);
      else await run.thread(item.key, item.body, item.place);
    }
    const { summaryKey, body } = submission;
    if (summaryKey && body.trim()) {
      await run.thread(summaryKey, body, { kind: 'conversation' });
    }
    await run.vote();
  } catch (err) {
    throw run.stopped(err);
  }
  return run.result();
}

class Run {
  private ledger: ReviewLedger;
  private context: IterationContext | null = null;

  constructor(
    private readonly api: AdoReviewApi,
    private readonly store: LedgerStore,
    private readonly submission: ReviewSubmission,
    private readonly me: string
  ) {
    const kept = store.read();
    // What is posted stays posted: a new head only changes where the
    // rest is anchored.
    this.ledger = kept
      ? { ...kept, head: submission.head }
      : freshLedger(submission.head);
  }

  result(): PublishedReview {
    return { reviewId: null, items: this.posted(), resumed: null };
  }

  /** Why it stopped, with what is posted: a read that failed after a
   *  write still leaves that write posted. */
  stopped(err: unknown): ReviewPublishError {
    if (err instanceof ReviewPublishError) return err;
    return new ReviewPublishError(
      'refused',
      err instanceof Error ? err.message : String(err),
      { cause: err, posted: this.posted() }
    );
  }

  /** The threads as they stand when this attempt begins: where a lost
   *  write is looked for, and what each write must not be taken for. */
  private threads: AdoReviewThread[] = [];

  /** A write whose answer was lost: found among the threads, or known
   *  not to have landed. */
  async reconcile(): Promise<void> {
    const { value } = await this.api.get<{ value: AdoReviewThread[] }>(
      `pullrequests/${this.submission.prId}/threads?${V}`
    );
    this.threads = value;
    const { inFlight, sending } = this.ledger;
    if (!inFlight || !sending || inFlight === 'submit') {
      if (inFlight && inFlight !== 'submit') this.save({ inFlight: null });
      return;
    }
    const recorded = new Set(Object.values(this.ledger.added).map((a) => a.id));
    const found = findPosted(value, sending, this.me, recorded);
    this.save({
      inFlight: null,
      sending: null,
      added: found
        ? {
            ...this.ledger.added,
            [inFlight]: { id: found, body: sending.body },
          }
        : this.ledger.added,
    });
  }

  async thread(key: string, body: string, place: ThreadPlace): Promise<void> {
    if (this.ledger.added[key]) return;
    const context =
      place.kind === 'conversation' ? null : await this.iterationContext();
    const posted = await this.step(key, this.sending(body, place), () =>
      this.api.send<{ id: number }>(
        'POST',
        `pullrequests/${this.submission.prId}/threads?${V}`,
        newThread(body, place, context)
      )
    );
    this.record(key, String(posted.id), body);
  }

  async reply(key: string, body: string, threadId: string): Promise<void> {
    if (this.ledger.added[key]) return;
    const path = `pullrequests/${this.submission.prId}/threads/${threadId}`;
    const thread = await this.api.get<AdoReviewThread>(`${path}?${V}`);
    const root = (thread.comments ?? []).find(
      (c) => c.commentType !== 'system'
    );
    const place: SentPlace = { kind: 'reply', threadId };
    const posted = await this.step(key, this.sending(body, place), () =>
      this.api.send<{ id: number }>('POST', `${path}/comments?${V}`, {
        parentCommentId: root?.id ?? 0,
        content: body,
        commentType: 1,
      })
    );
    this.record(key, String(posted.id), body);
  }

  /** The reviewer's vote, once everything chosen is posted. */
  async vote(): Promise<void> {
    const vote = VOTES[this.submission.event];
    if (vote === undefined) return;
    await this.step('submit', null, () =>
      this.api.send(
        'PUT',
        `pullrequests/${this.submission.prId}/reviewers/${this.me}?${V}`,
        { id: this.me, vote }
      )
    );
    this.save({ submitted: true, inFlight: null });
  }

  /** The iteration the reviewed head is, and its changes' tracking
   *  ids: read once, for the first comment on code. */
  private async iterationContext(): Promise<IterationContext> {
    if (this.context) return this.context;
    const { prId, head } = this.submission;
    const { value } = await this.api.get<{
      value: { id: number; sourceRefCommit?: { commitId?: string } }[];
    }>(`pullrequests/${prId}/iterations?${V}`);
    const iteration = [...value]
      .reverse()
      .find((i) => i.sourceRefCommit?.commitId === head)?.id;
    if (iteration === undefined) {
      throw new ReviewPublishError(
        'moved',
        'Azure DevOps has not recorded the reviewed commit as an update yet; try again shortly',
        { posted: this.posted() }
      );
    }
    this.context = {
      iteration,
      tracking: await this.trackingIds(prId, iteration),
    };
    return this.context;
  }

  private async trackingIds(
    prId: number,
    iteration: number
  ): Promise<Map<string, number>> {
    const tracking = new Map<string, number>();
    let skip = 0;
    for (;;) {
      const page = await this.api.get<{
        changeEntries?: {
          changeTrackingId?: number;
          item?: { path?: string };
        }[];
        nextSkip?: number;
      }>(
        `pullrequests/${prId}/iterations/${iteration}/changes?$compareTo=0&$skip=${skip}&${V}`
      );
      for (const c of page.changeEntries ?? []) {
        if (c.item?.path && c.changeTrackingId !== undefined) {
          tracking.set(c.item.path, c.changeTrackingId);
        }
      }
      if (!page.nextSkip || page.nextSkip <= skip) return tracking;
      skip = page.nextSkip;
    }
  }

  /** What a step is sending, and the look-alikes already there. */
  private sending(body: string, place: SentPlace): ReviewLedger['sending'] {
    return {
      body,
      place,
      before: lookAlikes(this.threads, { body, place }, this.me),
    };
  }

  private posted(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.ledger.added).map(([key, { id }]) => [key, id])
    );
  }

  private record(key: string, id: string, body: string): void {
    this.save({
      added: { ...this.ledger.added, [key]: { id, body } },
      inFlight: null,
      sending: null,
    });
  }

  /** Send one step: marked in flight first, cleared when refused. */
  private async step<T>(
    name: string,
    sending: ReviewLedger['sending'],
    send: () => Promise<T>
  ): Promise<T> {
    this.save({ inFlight: name, sending });
    const item = name === 'submit' ? null : name;
    try {
      return await send();
    } catch (err) {
      const details = { cause: err, item, posted: this.posted() };
      if (refused(err)) {
        this.save({ inFlight: null, sending: null });
        throw new ReviewPublishError(
          'refused',
          err instanceof Error ? err.message : String(err),
          details
        );
      }
      throw new ReviewPublishError(
        'unknown',
        'Azure DevOps did not answer; n10 will check what was posted before trying again',
        details
      );
    }
  }

  private save(patch: Partial<ReviewLedger>): void {
    this.ledger = { ...this.ledger, ...patch };
    this.store.write(this.ledger);
  }
}

/** Azure answered and turned the request away: nothing was written. A
 *  5xx or a dropped connection may have been after the write. */
function refused(err: unknown): boolean {
  if (!isVcsError(err)) return false;
  // 503 is Azure being unavailable, which may be mid-write.
  if (err.status === 503) return false;
  if (err.kind === 'throttled' || err.kind === 'auth') return true;
  return err.status !== undefined && err.status >= 400 && err.status < 500;
}
