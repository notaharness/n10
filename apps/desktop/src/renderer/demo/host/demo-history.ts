import type { PullRequestInfo } from '@n10/vcs-core';
import type { Checkpoint, RevisionEvent } from '../../../host/contract.js';
import { VIEWER } from '../data/identity.js';
import { standInOid } from './stand-in-oid.js';

/**
 * A demo pull request's history: three pushes ending at the head its
 * row reports, and where the reader stood. Someone else's pull request
 * was reviewed at the second push and last visited at the first; the
 * reader's own was last visited at the second and never reviewed. So
 * "since your last review" and "since your last visit" both show
 * something, and differ.
 */

const HOUR = 3_600_000;
const AGES = [72 * HOUR, 26 * HOUR, 2 * HOUR];

/** The pull request's pushes, oldest first. */
export function demoPushes(pr: PullRequestInfo, now = Date.now()) {
  return AGES.map((age, i) => ({
    // The head as the diff host names it (`pr-diff-host.ts`).
    oid:
      i === AGES.length - 1
        ? pr.headSha ?? standInOid(`${pr.sourceBranch}:head`)
        : standInOid(`${pr.sourceBranch}:${i}`),
    at: now - age,
  }));
}

export function demoEvents(pr: PullRequestInfo, now?: number): RevisionEvent[] {
  return demoPushes(pr, now).map((p) => ({
    kind: 'commit',
    head: p.oid,
    at: new Date(p.at).toISOString(),
  }));
}

/** A checkpoint at one of the pull request's pushes. */
function checkpointAt(
  pr: PullRequestInfo,
  i: number,
  now?: number
): Checkpoint {
  const push = demoPushes(pr, now)[i]!;
  return {
    head: push.oid,
    target: standInOid(pr.targetBranch),
    mergeBase: standInOid(`${pr.sourceBranch}:base`),
    at: push.at + HOUR,
  };
}

const mine = (pr: PullRequestInfo) => pr.createdByIdentifier === VIEWER;

/** Where the reader last reviewed, if they review this one at all. */
export function demoLastReview(pr: PullRequestInfo, now?: number) {
  if (mine(pr)) return null;
  const at = checkpointAt(pr, 1, now);
  return { head: at.head, at: new Date(at.at).toISOString() };
}

/** The visit before the demo opened. */
export function demoLastVisit(pr: PullRequestInfo, now?: number): Checkpoint {
  return checkpointAt(pr, mine(pr) ? 1 : 0, now);
}
