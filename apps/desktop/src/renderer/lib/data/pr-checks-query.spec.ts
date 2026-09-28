import { describe, expect, it } from 'vitest';
import type {
  PullRequestChecksAnswer,
  PullRequestRef,
} from '../../../host/contract.js';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
  keepRead,
  keepsLastHead,
  rowFacts,
  sameButHead,
} from './pr-checks-query.js';
import { keys } from './query-keys.js';

/** The checks read keeps what it read, and knows a push from another
 *  pull request. */

const REF: PullRequestRef = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 214,
};

function answer(checks: PullRequestChecksAnswer['checks']) {
  return { checks } as PullRequestChecksAnswer;
}

const read = answer({ state: 'read' } as PullRequestChecksAnswer['checks']);
const failed = answer({
  state: 'failed',
  kind: 'throttled',
  reason: 'Rate limited',
  retryAfterMs: 30_000,
});

describe('keepRead', () => {
  it('fails a re-read whose checks failed, so what was read stays on screen', () => {
    expect(() => keepRead(failed, read)).toThrow(
      /^Rate limited \(try again after .+\)$/
    );
  });

  it('takes the answer from the list row where nothing was read before', () => {
    expect(keepRead(failed, undefined)).toBe(failed);
    expect(keepRead(failed, failed)).toBe(failed);
    expect(keepRead(read, read)).toBe(read);
  });
});

describe('sameButHead', () => {
  const at = (head: string | null, ref = REF, viewer = 'bea') =>
    keys.prChecks('/repo', ref, viewer, head);

  it('keeps the last head’s answer only for the same pull request and account', () => {
    expect(sameButHead(at('a'.repeat(40)), at('b'.repeat(40)))).toBe(true);
    expect(sameButHead(at('a'), at('a', { ...REF, number: 215 }))).toBe(false);
    expect(sameButHead(at('a', REF, 'cy'), at('b'))).toBe(false);
    expect(sameButHead(undefined, at('b'))).toBe(false);
  });
});

describe('keepsLastHead', () => {
  const at = (head: string) => keys.prChecks('/repo', REF, 'bea', head);

  it('stands the last head in only until this head’s read has failed', () => {
    expect(keepsLastHead(at('a'), at('b'), 0)).toBe(true);
    // Retry after a failure keeps the failure in place.
    expect(keepsLastHead(at('a'), at('b'), 1)).toBe(false);
  });
});

describe('rowFacts', () => {
  const PR = {
    id: 214,
    buildStatus: 'pending',
    activeCommentCount: 1,
    reviewers: [
      { identifier: 'cy', displayName: 'Cy', decision: 'no-response' },
      { identifier: 'bea', displayName: 'Bea', decision: 'approved' },
    ],
  } as PullRequestInfo;

  it('moves when a check finishes, a review lands, a thread is resolved, or it leaves draft or is retargeted', () => {
    const facts = rowFacts(PR);
    expect(rowFacts({ ...PR, buildStatus: 'succeeded' })).not.toBe(facts);
    expect(rowFacts({ ...PR, activeCommentCount: 0 })).not.toBe(facts);
    expect(rowFacts({ ...PR, isDraft: true })).not.toBe(facts);
    expect(rowFacts({ ...PR, targetBranch: 'release' })).not.toBe(facts);
    expect(
      rowFacts({
        ...PR,
        reviewers: [
          { ...PR.reviewers![0], decision: 'approved' },
          PR.reviewers![1],
        ],
      })
    ).not.toBe(facts);
  });

  it('does not move for the order the reviewers are listed in', () => {
    expect(rowFacts({ ...PR, reviewers: [...PR.reviewers!].reverse() })).toBe(
      rowFacts(PR)
    );
  });
});
