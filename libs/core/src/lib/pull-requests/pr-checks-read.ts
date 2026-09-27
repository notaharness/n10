import {
  describePullRequest,
  readFailure,
  samePullRequest,
  type PullRequestChecks,
  type PullRequestRef,
  type ReadOutcome,
} from '@n10/vcs-core';
import {
  evaluateReadiness,
  type PullRequestReadiness,
} from './pr-readiness.js';
import {
  assertSameContext,
  assertSameRepositoryId,
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
  /** Null when the checks could not be read: nothing to evaluate. */
  readiness: PullRequestReadiness | null;
}

export interface ChecksSources
  extends Pick<SnapshotSources, 'repository' | 'viewer' | 'lookup' | 'now'> {
  /** Absent when the provider has no checks read. */
  checks?: (prId: number) => Promise<PullRequestChecks>;
}

async function readChecks(
  ref: PullRequestRef,
  read: ChecksSources['checks']
): Promise<ReadOutcome<PullRequestChecks>> {
  if (!read) {
    return {
      state: 'unsupported',
      reason: 'This provider does not read checks and policies',
    };
  }
  try {
    const value = await read(ref.number);
    return samePullRequest({ ...value.ref, id: undefined }, ref)
      ? { state: 'read', value }
      : readFailure(
          new Error(
            `The provider answered about ${describePullRequest(value.ref)}`
          )
        );
  } catch (err) {
    return readFailure(err);
  }
}

export async function readPullRequestChecks(
  req: SnapshotRequest,
  src: ChecksSources
): Promise<PullRequestChecksAnswer> {
  const viewer = assertSameContext(req, src);
  const [summary, checks] = await Promise.all([
    src.lookup(req.ref.number),
    readChecks(req.ref, src.checks),
  ]);
  assertSameContext({ ...req, viewer }, src);
  const readId = checks.state === 'read' ? checks.value.ref.id : undefined;
  assertSameRepositoryId(req, readId);
  // The list row's count of unresolved threads, which the checks read
  // does not carry: a lower bound, from its first page of threads, as
  // of the list's own read. Readiness uses it to explain, not to decide.
  const unresolved =
    summary.kind === 'found' ? summary.pr.activeCommentCount ?? null : null;
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
          })
        : null,
  };
}
