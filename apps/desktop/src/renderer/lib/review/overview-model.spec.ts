import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
  adoptPullRequest,
  initialMode,
  nextStep,
  readiness,
  reviewRole,
} from './overview-model.js';

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

const bea = (decision: Decision) => ({
  identifier: 'bea',
  displayName: 'Bea',
  decision,
});

describe('reviewRole', () => {
  it('knows the author, however the provider cases the login', () => {
    expect(reviewRole(PR, 'ALEX')).toBe('author');
    expect(reviewRole(PR, 'bea')).toBe('reviewer');
  });

  it('reads an unknown account as a reviewer', () => {
    // The Overview is the safe start: it shows the change before code.
    expect(reviewRole(PR, null)).toBe('reviewer');
  });
});

describe('initialMode', () => {
  it("opens someone else's pull request on its Overview", () => {
    expect(initialMode({ running: false, hasPr: true, role: 'reviewer' })).toBe(
      'overview'
    );
  });

  it('opens your own pull request, and a bare worktree, on the diff', () => {
    expect(initialMode({ running: false, hasPr: true, role: 'author' })).toBe(
      'diff'
    );
    expect(initialMode({ running: false, hasPr: false, role: 'author' })).toBe(
      'diff'
    );
  });

  it('opens on a running agent whoever wrote the pull request', () => {
    expect(initialMode({ running: true, hasPr: true, role: 'reviewer' })).toBe(
      'agent'
    );
  });
});

describe('adoptPullRequest', () => {
  it('opens a pull request that arrives late where it would have opened', () => {
    const opened = { mode: 'diff' as const, chosen: false, hasPr: false };
    expect(adoptPullRequest(opened, true, 'overview')).toEqual({
      mode: 'overview',
      chosen: false,
      hasPr: true,
    });
  });

  it('keeps a pane the reader picked', () => {
    const picked = { mode: 'diff' as const, chosen: true, hasPr: false };
    expect(adoptPullRequest(picked, true, 'overview').mode).toBe('diff');
  });

  it('changes nothing while the pull request stays', () => {
    const state = { mode: 'diff' as const, chosen: false, hasPr: true };
    expect(adoptPullRequest(state, true, 'overview')).toBe(state);
  });
});

describe('nextStep', () => {
  it('asks a requested reviewer to review the changes', () => {
    const pr = { ...PR, reviewers: [bea('no-response')] };
    expect(nextStep(pr, 'reviewer', 'bea')).toEqual({
      summary: 'Your review is requested',
      detail: null,
      action: 'review-changes',
      label: 'Review changes',
    });
  });

  it.each([
    ['approved', 'You approved this pull request'],
    ['changes-requested', 'You asked for changes'],
    ['waiting-for-author', 'You are waiting for the author'],
    ['rejected', 'You rejected this pull request'],
    ['declined', 'You declined to review'],
  ] as const)('tells a reviewer who voted %s so', (decision, summary) => {
    const pr = { ...PR, reviewers: [bea(decision)] };
    expect(nextStep(pr, 'reviewer', 'bea').summary).toBe(summary);
  });

  it('never says your review is requested on a draft', () => {
    const pr = { ...PR, isDraft: true, reviewers: [bea('no-response')] };
    expect(nextStep(pr, 'reviewer', 'bea')).toMatchObject({
      summary: 'Draft: not ready for review yet',
      label: 'View changes',
    });
  });

  it('claims nothing about "you" without an account', () => {
    expect(nextStep(PR, 'reviewer', null)).toMatchObject({
      summary: 'n10 cannot see your review',
      detail: 'No account is configured for this repository.',
    });
    expect(nextStep(PR, 'reviewer', 'carol').summary).toBe(
      'Not reviewed by you yet'
    );
  });

  it('sends an author with unresolved threads to them, and only says how many', () => {
    const pr = { ...PR, activeCommentCount: 2, reviewers: [bea('approved')] };
    // Who owes the next move on each thread is not something a count says.
    expect(nextStep(pr, 'author', 'alex')).toEqual({
      summary: '2 unresolved threads',
      detail: null,
      action: 'show-unresolved',
      label: 'Respond to feedback',
    });
  });

  it.each([
    ['rejected', 'Rejected by Bea'],
    ['waiting-for-author', 'Waiting for author: Bea'],
    ['changes-requested', 'Changes requested by Bea'],
  ] as const)(
    'tells an author about a %s vote in its own words',
    (d, summary) => {
      expect(
        nextStep({ ...PR, reviewers: [bea(d)] }, 'author', 'alex').summary
      ).toBe(summary);
    }
  );

  it('names who asked an author for changes before anything else', () => {
    const pr = { ...PR, isDraft: true, reviewers: [bea('changes-requested')] };
    expect(nextStep(pr, 'author', 'alex').summary).toBe(
      'Changes requested by Bea'
    );
  });

  it('says a draft is a draft, and who approved a ready one', () => {
    expect(nextStep({ ...PR, isDraft: true }, 'author', 'alex').summary).toBe(
      'Draft'
    );
    const approvers = [
      bea('approved'),
      { identifier: 'cy', displayName: 'Cy', decision: 'approved' as const },
    ];
    expect(
      nextStep({ ...PR, reviewers: approvers }, 'author', 'alex').summary
    ).toBe('Approved by Bea and 1 other');
    expect(nextStep(PR, 'author', 'alex')).toMatchObject({
      summary: 'Waiting for review',
      detail: 'No reviewers are requested.',
    });
  });
});

describe('readiness', () => {
  const cy = (decision: Decision) => ({
    identifier: 'cy',
    displayName: 'Cy',
    decision,
  });
  const row = (pr: PullRequestInfo, id: string) =>
    readiness(pr).rows.find((r) => r.id === id);

  it('never calls a pull request ready, or a requirement met, from the list', () => {
    // Everything n10 can see is green; what it cannot see still decides,
    // so an approval and passing checks are observations, not verdicts.
    // Only the state is met: the provider itself says it is open.
    const green = {
      ...PR,
      buildStatus: 'succeeded' as const,
      reviewers: [bea('approved')],
    };
    const r = readiness(green);
    expect(r.headline).toEqual({
      state: 'unknown',
      text: 'Readiness not fully known',
      detail: null,
    });
    expect(r.rows.map((x) => [x.id, x.state, x.text])).toEqual([
      ['lifecycle', 'met', 'Open'],
      ['reviews', 'observed', 'Approved by Bea'],
      ['checks', 'observed', 'Reported checks pass'],
      [
        'unknown',
        'unknown',
        'Conflicts, branch policies and merge permission are not visible to n10',
      ],
    ]);
  });

  it('counts who is still to review', () => {
    expect(
      row({ ...PR, reviewers: [bea('approved'), cy('no-response')] }, 'reviews')
    ).toMatchObject({
      state: 'observed',
      text: 'Approved by Bea · 1 pending',
    });
    // A declined request asks nothing more.
    expect(
      row({ ...PR, reviewers: [bea('approved'), cy('declined')] }, 'reviews')
        ?.text
    ).toBe('Approved by Bea');
    // Nobody left to ask is not the same as nobody asked.
    expect(
      row({ ...PR, reviewers: [cy('declined')] }, 'reviews')
    ).toMatchObject({ state: 'observed', text: 'Declined by Cy' });
    expect(row({ ...PR, reviewers: [] }, 'reviews')?.text).toBe(
      'No reviewers requested'
    );
  });

  it('shows problems as concerns beside "not fully known", never as blockers', () => {
    // A failing check may be optional, and changes requested block only
    // where the provider's rules say so; neither is read here.
    const r = readiness({
      ...PR,
      buildStatus: 'failed',
      reviewers: [bea('changes-requested')],
    });
    expect(r.headline).toEqual({
      state: 'unknown',
      text: 'Readiness not fully known',
      detail: 'Changes requested by Bea · Checks failing',
    });
    expect(
      r.rows.filter((x) => x.state === 'concern').map((x) => x.id)
    ).toEqual(['reviews', 'checks']);
    expect(r.rows.some((x) => x.state === 'blocked')).toBe(false);
  });

  it("keeps Azure's votes apart, most severe first", () => {
    // Rejected keeps the red it has in the reviewers list and header.
    expect(
      row(
        { ...PR, reviewers: [bea('waiting-for-author'), cy('rejected')] },
        'reviews'
      )
    ).toMatchObject({ text: 'Rejected by Cy', severe: true });
    expect(
      row({ ...PR, reviewers: [bea('waiting-for-author')] }, 'reviews')
    ).toMatchObject({ text: 'Waiting for author: Bea', severe: false });
  });

  it('says a draft is not ready: the provider says so itself', () => {
    const r = readiness({ ...PR, isDraft: true, buildStatus: 'succeeded' });
    expect(r.headline).toEqual({
      state: 'waiting',
      text: 'Draft: not ready to merge',
      detail: null,
    });
  });

  it('reports no checks as unknown, not as passing', () => {
    expect(row(PR, 'checks')).toMatchObject({
      state: 'unknown',
      text: 'None reported',
    });
  });
});
