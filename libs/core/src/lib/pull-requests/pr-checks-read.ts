import type {
  PullRequestChecks,
  PullRequestRef,
  ReadOutcome,
} from '@n10/vcs-core';
import { checkList, type CheckList } from './pr-check-list.js';
import { listReadiness } from './pr-readiness-list.js';
import {
  evaluateReadiness,
  type PullRequestReadiness,
} from './pr-readiness.js';
import {
  asksViewer,
  reviewRequirements,
  type ReviewRequirements,
} from './pr-review-requirements.js';
import {
  assertSameContext,
  assertSameRepositoryId,
  readAbout,
  withId,
  type SnapshotRequest,
  type SnapshotSources,
} from './pr-snapshot.js';

/**
 * What stands between one pull request and completion, read by identity
 * like its snapshot: the repository and the account are checked before
 * the reads and again after them, and an answer about another pull
 * request is refused.
 */
export interface PullRequestChecksAnswer {
  /** The ref asked about, with the repository id the provider gave:
   *  never the caller's own id returned as though confirmed. */
  ref: PullRequestRef;
  viewer: string | null;
  fetchedAt: number;
  checks: ReadOutcome<PullRequestChecks>;
  /** From the checks where they were read; from the list row where
   *  not, which leaves it not fully known. */
  readiness: PullRequestReadiness;
  /** The checks and policies to read, in order; null where they could
   *  not be read. */
  list: CheckList | null;
  /** Who must review and why, from the detail read and the rules. */
  requirements: ReviewRequirements;
}

export interface ChecksSources
  extends Pick<
    SnapshotSources,
    'repository' | 'viewer' | 'lookup' | 'detail' | 'now'
  > {
  /** Absent when the provider has no checks read. */
  checks?: (prId: number) => Promise<PullRequestChecks>;
}

export async function readPullRequestChecks(
  req: SnapshotRequest,
  src: ChecksSources
): Promise<PullRequestChecksAnswer> {
  const viewer = assertSameContext(req, src);
  const [summary, checks, detail] = await Promise.all([
    src.lookup(req.ref.number),
    readAbout(
      req.ref,
      src.checks,
      'This provider does not read checks and policies'
    ),
    // Who is required, and so whether the viewer's review would count.
    readAbout(
      req.ref,
      src.detail,
      'This provider does not read pull request detail'
    ),
  ]);
  assertSameContext({ ...req, viewer }, src);
  const readId = checks.state === 'read' ? checks.value.ref.id : undefined;
  assertSameRepositoryId(req, readId);
  assertSameRepositoryId(
    req,
    detail.state === 'read' ? detail.value.ref.id : undefined
  );
  const rules = checks.state === 'read' ? checks.value.rules : null;
  // The list row's count of unresolved threads, which the checks read
  // does not carry: a lower bound, from its first page of threads, as
  // of the list's own read. Readiness uses it to explain, not to decide.
  const row = summary.kind === 'found' ? summary.pr : null;
  const unresolved = row?.activeCommentCount ?? null;
  return {
    ref: withId(req.ref, readId),
    viewer,
    fetchedAt: (src.now ?? Date.now)(),
    checks,
    readiness:
      checks.state === 'read'
        ? evaluateReadiness({
            merge: checks.value.merge,
            checks: checks.value.checks,
            rules: checks.value.rules,
            unresolvedThreads: unresolved,
            viewerAsked: asksViewer(row, viewer, detail, rules),
          })
        : listReadiness(row),
    list: checks.state === 'read' ? checkList(checks.value) : null,
    requirements: reviewRequirements(detail, rules),
  };
}
