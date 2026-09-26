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
  /** The ref asked about, with the repository's `id` once the detail
   *  read has named it — the id to store beside anything persisted. */
  ref: PullRequestRef;
  /** The account n10 is configured to act as: the GitHub username, or
   *  the Azure DevOps email. Configured, not proven: a credential
   *  swapped outside n10 is not detected here. */
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

/**
 * Where a snapshot's facts come from; the shell supplies these. The
 * repository and the account are asked for before the reads and again
 * after them: either can change while a read is in flight, and an
 * answer is only returned for the context it was asked in.
 */
export interface SnapshotSources {
  /** The repository open in this shell now, as its provider names it. */
  repository: () => RepositoryRef | null;
  viewer: () => string | null;
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

/** The account the context reads as; throws unless the repository and
 *  the account are the ones the caller asked about. */
function assertSameContext(
  req: SnapshotRequest,
  src: SnapshotSources
): string | null {
  const repository = src.repository();
  if (!repository) {
    throw new PullRequestIdentityError(
      'No pull request provider is configured for this repository'
    );
  }
  if (!sameRepository(req.ref, repository)) {
    throw new PullRequestIdentityError(
      `${describePullRequest(req.ref)} is not in ${repository.host}/${
        repository.repository
      }, the repository open now`
    );
  }
  const viewer = src.viewer();
  const asked = req.viewer?.toLowerCase();
  if (asked !== undefined && asked !== viewer?.toLowerCase()) {
    throw new PullRequestIdentityError(
      `n10 acts as ${viewer ?? 'nobody'} now, not ${req.viewer}`
    );
  }
  return viewer;
}

/**
 * The repository at this path is not the one the caller knew: renamed
 * away and replaced, or transferred. Its #N is some other pull request,
 * so nothing read about it may answer for the one asked.
 */
function assertSameRepositoryId(
  req: SnapshotRequest,
  detail: ReadOutcome<PullRequestDetail>
): void {
  const known = req.ref.id;
  const now = detail.state === 'read' ? detail.value.ref.id : undefined;
  if (known != null && now != null && known !== now) {
    throw new PullRequestIdentityError(
      `${req.ref.host}/${req.ref.repository} is now a different repository than the one this pull request was read from`
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
    // it came back — never let it lend this one its commits. The id is
    // left out: a replaced repository is refused as a whole, below.
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
  // Asked again after the reads: the list is cached per checkout, not
  // per repository, so a config change while they ran would hand back
  // another repository's row under this ref.
  const viewer = assertSameContext(req, src);
  assertSameRepositoryId(req, detail);
  const target = detail.state === 'read' ? detail.value.target.head : null;
  const id = detail.state === 'read' ? detail.value.ref.id : req.ref.id;
  return {
    ref: id === undefined ? req.ref : { ...req.ref, id },
    viewer,
    fetchedAt: (src.now ?? Date.now)(),
    summary,
    detail,
    head: reportedHead(summary, detail),
    target: isOid(target) ? target : null,
  };
}
