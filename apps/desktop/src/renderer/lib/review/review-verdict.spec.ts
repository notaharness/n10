import { describe, expect, it } from 'vitest';
import {
  reviewersToCount,
  type PullRequestReviewer,
} from '@n10/vcs-core/types';
import { verdictDecision, withViewerVerdict } from './review-verdict.js';

/**
 * The optimistic patch `useSubmitVerdict` writes into the cached
 * sidebar goes through this fold, so a wrong answer here paints the
 * wrong reviewer dot on the row until the next remote refresh lands.
 */
describe('verdictDecision', () => {
  it('reads both approving verdicts as an approval', () => {
    expect(verdictDecision('approve', 'github')).toBe('approved');
    expect(verdictDecision('approve-with-suggestions', 'github')).toBe(
      'approved'
    );
    expect(verdictDecision('approve', 'azure-devops')).toBe('approved');
  });

  it('folds the whole negative side into changes-requested on GitHub', () => {
    // GitHub has no "waiting for author" review state, so both negative
    // verdicts have to land on the one state it does record.
    expect(verdictDecision('reject', 'github')).toBe('changes-requested');
    expect(verdictDecision('wait-for-author', 'github')).toBe(
      'changes-requested'
    );
  });

  it('keeps waiting-for-author apart from rejection elsewhere', () => {
    expect(verdictDecision('wait-for-author', 'azure-devops')).toBe(
      'waiting-for-author'
    );
    expect(verdictDecision('reject', 'azure-devops')).toBe('rejected');
  });

  it('treats an unknown provider like the general case, not like GitHub', () => {
    expect(verdictDecision('wait-for-author', undefined)).toBe(
      'waiting-for-author'
    );
    expect(verdictDecision('reject', undefined)).toBe('rejected');
  });
});

const TEAM = 'vstfs:///Classification/TeamProject/proj\\Core Team';
const team = (
  decision: PullRequestReviewer['decision']
): PullRequestReviewer => ({
  displayName: 'Core Team',
  identifier: TEAM,
  decision,
  includesViewer: true,
});

describe('withViewerVerdict', () => {
  it('takes the decision on the viewer’s own row, whatever its case', () => {
    const next = withViewerVerdict(
      [
        {
          displayName: 'Me',
          identifier: 'Me@Example.com',
          decision: 'rejected',
        },
      ],
      'me@example.com',
      'approved'
    );
    expect(next).toEqual([
      { displayName: 'Me', identifier: 'Me@Example.com', decision: 'approved' },
    ]);
  });

  it('adds a You row when the viewer is not listed', () => {
    expect(withViewerVerdict([], 'octocat', 'changes-requested')).toEqual([
      {
        identifier: 'octocat',
        displayName: 'You',
        decision: 'changes-requested',
      },
    ]);
  });

  /** The patch must count as the re-read will: the vote a team of the
   *  viewer's is waiting on is the viewer's, once. */
  it('names the viewer’s teams, so their vote counts once', () => {
    const asked = withViewerVerdict(
      [team('no-response')],
      'me@example.com',
      'approved'
    );
    expect(asked[1]).toMatchObject({ displayName: 'You', votedFor: [TEAM] });
    expect(reviewersToCount(asked).map((r) => r.displayName)).toEqual(['You']);

    const listed = withViewerVerdict(
      [
        team('no-response'),
        {
          displayName: 'Me',
          identifier: 'me@example.com',
          decision: 'no-response',
        },
      ],
      'me@example.com',
      'approved'
    );
    expect(reviewersToCount(listed)).toEqual([
      {
        displayName: 'Me',
        identifier: 'me@example.com',
        decision: 'approved',
        votedFor: [TEAM],
      },
    ]);
  });

  it('keeps the groups an earlier vote answered for', () => {
    const reviewersGroup = '[proj]\\Reviewers';
    const next = withViewerVerdict(
      [
        team('no-response'),
        {
          displayName: 'Reviewers',
          identifier: reviewersGroup,
          decision: 'rejected',
        },
        {
          displayName: 'Me',
          identifier: 'me@example.com',
          decision: 'rejected',
          votedFor: [reviewersGroup],
        },
      ],
      'me@example.com',
      'approved'
    );
    expect(reviewersToCount(next)).toEqual([
      {
        displayName: 'Me',
        identifier: 'me@example.com',
        decision: 'approved',
        votedFor: [reviewersGroup, TEAM],
      },
    ]);
  });

  it('names no group the viewer is not in', () => {
    const next = withViewerVerdict(
      [{ ...team('no-response'), includesViewer: undefined }],
      'me@example.com',
      'approved'
    );
    expect(next[1]).not.toHaveProperty('votedFor');
  });
});
