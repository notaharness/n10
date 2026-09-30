import { describe, expect, it } from 'vitest';
import {
  asksForReview,
  holdingVerdict,
  viewerEntry,
  reviewersToCount,
  type PullRequestReviewer,
  type ReviewDecision,
} from './types.js';

const by = (name: string, decision: ReviewDecision) => ({ name, decision });

describe('holdingVerdict', () => {
  it('names the most severe verdict holding it back, with everyone who gave it', () => {
    expect(
      holdingVerdict([
        by('bea', 'changes-requested'),
        by('cy', 'waiting-for-author'),
        by('di', 'waiting-for-author'),
        by('ed', 'approved'),
      ])
    ).toEqual({
      decision: 'waiting-for-author',
      by: [by('cy', 'waiting-for-author'), by('di', 'waiting-for-author')],
    });
    expect(
      holdingVerdict([by('bea', 'waiting-for-author'), by('cy', 'rejected')])
        ?.decision
    ).toBe('rejected');
  });

  it('is null where nothing holds it back', () => {
    expect(
      holdingVerdict([by('bea', 'approved'), by('cy', 'no-response')])
    ).toBeNull();
    expect(holdingVerdict([by('bea', 'declined')])).toBeNull();
  });
});

describe('asksForReview', () => {
  const reviewer = (decision: ReviewDecision, requested?: boolean) => ({
    identifier: 'bob',
    displayName: 'Bob',
    decision,
    requested,
  });

  it('takes the request where the list states it', () => {
    // GitHub: asked, asked again after a verdict, or only commented.
    expect(asksForReview(reviewer('no-response', true))).toBe(true);
    expect(asksForReview(reviewer('approved', true))).toBe(true);
    expect(asksForReview(reviewer('no-response', false))).toBe(false);
    expect(asksForReview(reviewer('declined', true))).toBe(false);
  });

  it('asks a listed reviewer with no vote where the list does not say', () => {
    // Azure DevOps keeps no request apart from its list.
    expect(asksForReview(reviewer('no-response'))).toBe(true);
    expect(asksForReview(reviewer('approved'))).toBe(false);
  });
});

describe('viewerEntry', () => {
  const me = {
    identifier: 'me',
    displayName: 'Me',
    decision: 'approved' as const,
  };
  const team = (decision: ReviewDecision) => ({
    identifier: 'core-team',
    displayName: 'Core Team',
    decision,
    includesViewer: true,
  });
  const isMe = (r: { identifier: string }) => r.identifier === 'me';

  it('takes the viewer’s own entry first', () => {
    expect(viewerEntry([team('no-response'), me], isMe)).toBe(me);
  });

  it('stands a still-asked group of theirs in for them', () => {
    const asked = team('no-response');
    expect(viewerEntry([asked], isMe)).toBe(asked);
  });

  it('never gives them a group’s vote, or a group they are not in', () => {
    expect(viewerEntry([team('approved')], isMe)).toBeUndefined();
    expect(
      viewerEntry([{ ...team('no-response'), includesViewer: false }], isMe)
    ).toBeUndefined();
  });
});

const team: PullRequestReviewer = {
  displayName: '[proj]\\Core Team',
  identifier: 'vstfs:///Classification/TeamProject/proj\\Core Team',
  decision: 'approved',
};
const teammate: PullRequestReviewer = {
  displayName: 'Teammate',
  identifier: 'teammate@example.com',
  decision: 'approved',
  votedFor: [team.identifier],
};

describe('reviewersToCount', () => {
  /** Azure lists a teammate's vote for a team twice: on the team's row
   *  and on the teammate's own. It is one vote. */
  it('counts a group answered by a listed member once, as the member', () => {
    expect(reviewersToCount([team, teammate])).toEqual([teammate]);
  });

  it('keeps a group nobody listed has voted for', () => {
    const pending = { ...team, decision: 'no-response' as const };
    const other = { ...teammate, votedFor: undefined };
    const none = { ...teammate, identifier: 'b@example.com', votedFor: [] };
    const rows = [pending, other, none];
    expect(reviewersToCount(rows)).toEqual(rows);
  });

  it('keeps a group whose voter is not listed', () => {
    expect(reviewersToCount([team])).toEqual([team]);
  });
});
