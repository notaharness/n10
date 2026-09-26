import {
  describePullRequest,
  isOid,
  parsePullRequestRef,
  readFailure,
  samePullRequest,
  sameRepository,
  type Oid,
  type PullRequestDetail,
  type PullRequestRef,
  type ReadOutcome,
  type RepositoryRef,
} from '@n10/vcs-core';
import type { PullRequestLookup } from './pull-request-cache.js';

/**
 * One pull request as a reader sees it at one moment: which pull
 * request, read as whom, what the list and the provider say about it,
 * and which commits the provider reports for it.
 *
 * Every answer echoes the ref it was asked for and the account it was
 * read as. A caller holding an answer can therefore tell whether it
 * still belongs to what is on screen — the repository may have changed
 * while the request was in flight, and repo A's #42 must never be read
 * as repo B's.
 *
 * The commits are the provider's claims, not a comparison: resolving
 * them in the clone, fetching what is missing and never standing a
 * local branch in for them is `resolvePrComparison`'s job.
 */
export interface PullRequestSnapshot {
  ref: PullRequestRef;
  /** The account the provider was read as (login or email). */
  viewer: string | null;
  fetchedAt: number;
  /** The row from the cached list, which the sidebar shows. */
  summary: PullRequestLookup;
  /** The provider's own detail read for this pull request. */
  detail: ReadOutcome<PullRequestDetail>;
  /** The head the provider reports now, and which read said so: the
   *  detail when it was read, else the list row. Null when neither
   *  names a full commit id. */
  head: { oid: Oid; from: 'detail' | 'list' } | null;
  /** The target branch's commit as the provider reports it. Only the
   *  detail names one; without it a comparison uses the clone's tip. */
  target: Oid | null;
}

export interface SnapshotRequest {
  ref: PullRequestRef;
  /** The account the caller last saw. A different one now means the
   *  caller's state belongs to someone else, so the read is refused. */
  viewer?: string;
}

/** Where a snapshot's facts come from; the shell supplies these. */
export interface SnapshotSources {
  /** The repository open in this shell, as its provider names it. */
  repository: RepositoryRef | null;
  viewer: string | null;
  lookup: (prId: number) => Promise<PullRequestLookup>;
  /** Absent when the provider has no detail read. */
  detail?: (prId: number) => Promise<PullRequestDetail>;
  now?: () => number;
}

/** The request is about something other than what is open here. */
export class PullRequestIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PullRequestIdentityError';
  }
}

/** A snapshot request from untrusted input. Throws on anything off. */
export function parseSnapshotRequest(value: unknown): SnapshotRequest {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Invalid snapshot request');
  }
  const { ref, viewer } = value as Record<string, unknown>;
  const req: SnapshotRequest = { ref: parsePullRequestRef(ref) };
  if (viewer !== undefined) {
    if (typeof viewer !== 'string') throw new TypeError('Invalid viewer');
    req.viewer = viewer;
  }
  return req;
}

function assertSameContext(req: SnapshotRequest, src: SnapshotSources): void {
  if (!src.repository) {
    throw new PullRequestIdentityError(
      'No pull request provider is configured for this repository'
    );
  }
  if (!sameRepository(req.ref, src.repository)) {
    throw new PullRequestIdentityError(
      `${describePullRequest(req.ref)} is not in ${src.repository.host}/${
        src.repository.repository
      }, the repository open now`
    );
  }
  const asked = req.viewer?.toLowerCase();
  if (asked !== undefined && asked !== src.viewer?.toLowerCase()) {
    throw new PullRequestIdentityError(
      `Signed in as ${src.viewer ?? 'nobody'} now, not ${req.viewer}`
    );
  }
}

async function readDetail(
  ref: PullRequestRef,
  read: SnapshotSources['detail']
): Promise<ReadOutcome<PullRequestDetail>> {
  if (!read) {
    return {
      state: 'unsupported',
      reason: 'This provider does not read pull request detail',
    };
  }
  try {
    const value = await read(ref.number);
    // A detail about some other pull request is not this one's, however
    // it came back — never let it lend this one its commits.
    return samePullRequest(value.ref, ref)
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

function reportedHead(
  summary: PullRequestLookup,
  detail: ReadOutcome<PullRequestDetail>
): PullRequestSnapshot['head'] {
  if (detail.state === 'read' && isOid(detail.value.source.head)) {
    return { oid: detail.value.source.head, from: 'detail' };
  }
  const listed = summary.kind === 'found' ? summary.pr.headSha : undefined;
  return isOid(listed) ? { oid: listed, from: 'list' } : null;
}

export async function readPullRequestSnapshot(
  req: SnapshotRequest,
  src: SnapshotSources
): Promise<PullRequestSnapshot> {
  assertSameContext(req, src);
  const [summary, detail] = await Promise.all([
    src.lookup(req.ref.number),
    readDetail(req.ref, src.detail),
  ]);
  const target = detail.state === 'read' ? detail.value.target.head : null;
  return {
    ref: req.ref,
    viewer: src.viewer,
    fetchedAt: (src.now ?? Date.now)(),
    summary,
    detail,
    head: reportedHead(summary, detail),
    target: isOid(target) ? target : null,
  };
}
