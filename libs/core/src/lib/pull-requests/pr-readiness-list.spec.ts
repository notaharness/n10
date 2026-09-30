import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core';
import { listReadiness } from './pr-readiness-list.js';

/** Readiness from the list row alone, where the checks read failed. */

const PR: PullRequestInfo = {
  id: 214,
  title: 'Handle cancelled requests',
  sourceBranch: 'feature/cancel',
  targetBranch: 'main',
  url: 'https://github.com/acme/app/pull/214',
  createdByIdentifier: 'alex',
  createdByDisplayName: 'Alex',
};

type Decision = NonNullable<PullRequestInfo['reviewers']>[number]['decision'];

const who = (name: string) => (decision: Decision) => ({
  identifier: name.toLowerCase(),
  displayName: name,
  decision,
});
const bea = who('Bea');
const cy = who('Cy');

function aspect(pr: PullRequestInfo | null, id: string) {
  return listReadiness(pr).aspects.find((a) => a.id === id);
}

describe('listReadiness', () => {
  it('never calls a pull request ready, or a requirement met, from the list', () => {
    // Everything the row shows is green; what it cannot show still
    // decides, so an approval and passing checks are observations. Only
    // the lifecycle is a verdict: the provider says it is open.
    const r = listReadiness({
      ...PR,
      buildStatus: 'succeeded',
      reviewers: [bea('approved')],
      activeCommentCount: 0,
    });
    expect(r.state).toBe('unknown');
    expect(r.blockers).toEqual([]);
    expect(r.aspects.map((a) => [a.id, a.state, a.text])).toEqual([
      ['lifecycle', 'met', 'Open'],
      ['reviews', 'observed', 'Approved by Bea'],
      ['checks', 'observed', 'Reported checks pass'],
      ['conversations', 'observed', 'None unresolved'],
    ]);
    expect(r.unknowns).toEqual([
      'Checks and policies',
      'Conflicts',
      'The review requirement',
    ]);
  });

  it('counts who is still to review', () => {
    expect(
      aspect(
        { ...PR, reviewers: [bea('approved'), cy('no-response')] },
        'reviews'
      )
    ).toMatchObject({ state: 'observed', text: 'Approved by Bea · 1 pending' });
    // A declined request asks nothing more.
    expect(
      aspect({ ...PR, reviewers: [bea('approved'), cy('declined')] }, 'reviews')
        ?.text
    ).toBe('Approved by Bea');
    // Nobody left to ask is not the same as nobody asked.
    expect(
      aspect({ ...PR, reviewers: [cy('declined')] }, 'reviews')?.text
    ).toBe('Declined by Cy');
    expect(aspect({ ...PR, reviewers: [] }, 'reviews')?.text).toBe(
      'No reviewers requested'
    );
  });

  it('counts a team a listed teammate voted for as that one vote', () => {
    const team = { ...who('Core Team')('approved'), identifier: 'core-team' };
    const teammate = { ...bea('approved'), votedFor: ['core-team'] };
    expect(
      aspect(
        { ...PR, reviewers: [team, teammate, cy('no-response')] },
        'reviews'
      )?.text
    ).toBe('Approved by Bea · 1 pending');
  });

  it('shows problems as advisories beside "not fully known", never as blockers', () => {
    // A failing check may be optional, and changes requested block only
    // where the provider's rules say so; neither is read here.
    const r = listReadiness({
      ...PR,
      buildStatus: 'failed',
      reviewers: [bea('changes-requested')],
    });
    expect(r.state).toBe('unknown');
    expect(r.blockers).toEqual([]);
    expect(r.advisories.map((a) => a.text)).toEqual([
      'Changes requested by Bea',
      'Checks failing',
    ]);
  });

  it("keeps Azure's votes apart, most severe first", () => {
    expect(
      aspect(
        { ...PR, reviewers: [bea('waiting-for-author'), cy('rejected')] },
        'reviews'
      )
    ).toMatchObject({ text: 'Rejected by Cy', severe: true });
    expect(
      aspect({ ...PR, reviewers: [bea('waiting-for-author')] }, 'reviews')
    ).toMatchObject({ text: 'Waiting for author: Bea', severe: false });
  });

  it('blocks a draft: the provider says so itself', () => {
    const r = listReadiness({ ...PR, isDraft: true, buildStatus: 'succeeded' });
    expect(r.state).toBe('blocked');
    expect(r.blockers.map((b) => b.kind)).toEqual(['draft']);
  });

  it('reports no checks as unknown, not as passing', () => {
    expect(aspect(PR, 'checks')).toMatchObject({
      state: 'unknown',
      text: 'None reported',
    });
  });

  it('reads nothing at all where the list has no row either', () => {
    const r = listReadiness(null);
    expect(r.state).toBe('unknown');
    expect(r.aspects.every((a) => a.state === 'unknown')).toBe(true);
  });
});
