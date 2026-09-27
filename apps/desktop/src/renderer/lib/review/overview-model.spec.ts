import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
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

const bea = (decision: 'approved' | 'changes-requested' | 'no-response') => ({
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

  it('tells a reviewer where their own verdict stands', () => {
    expect(
      nextStep({ ...PR, reviewers: [bea('approved')] }, 'reviewer', 'bea')
        .summary
    ).toBe('You approved this pull request');
    expect(
      nextStep(
        { ...PR, reviewers: [bea('changes-requested')] },
        'reviewer',
        'bea'
      ).summary
    ).toBe('You asked for changes');
    expect(nextStep(PR, 'reviewer', 'carol').summary).toBe(
      'Not reviewed by you yet'
    );
  });

  it('sends an author with unresolved threads to them', () => {
    const pr = { ...PR, activeCommentCount: 2, reviewers: [bea('approved')] };
    expect(nextStep(pr, 'author', 'alex')).toMatchObject({
      summary: '2 unresolved threads',
      action: 'show-unresolved',
      label: 'Respond to feedback',
    });
  });

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
  it('never calls a pull request ready while policies are unread', () => {
    // Everything n10 can see is green; what it cannot see still decides.
    const green = {
      ...PR,
      buildStatus: 'succeeded' as const,
      reviewers: [bea('approved')],
    };
    const r = readiness(green);
    expect(r.headline).toEqual({
      state: 'unknown',
      text: 'Readiness not fully known',
    });
    expect(r.rows.map((row) => [row.id, row.state])).toEqual([
      ['lifecycle', 'met'],
      ['reviews', 'met'],
      ['checks', 'met'],
      ['conflicts', 'unknown'],
      ['merge', 'unknown'],
    ]);
  });

  it('leads with the first blocker it can see', () => {
    const r = readiness({
      ...PR,
      buildStatus: 'failed',
      reviewers: [bea('changes-requested')],
    });
    expect(r.headline).toEqual({
      state: 'blocked',
      text: 'Changes requested by Bea',
    });
    expect(r.rows.find((row) => row.id === 'checks')).toMatchObject({
      state: 'blocked',
      text: 'Checks failing',
    });
  });

  it('keeps a failed check apart from the reviews', () => {
    // A red build is not a review verdict, and the rows say which is which.
    const r = readiness({ ...PR, buildStatus: 'failed' });
    expect(r.headline.text).toBe('Checks failing');
    expect(r.rows.find((row) => row.id === 'reviews')).toMatchObject({
      state: 'waiting',
      text: 'No reviewers requested',
    });
  });

  it('says a draft is not ready, whatever else is green', () => {
    const r = readiness({ ...PR, isDraft: true, buildStatus: 'succeeded' });
    expect(r.headline).toEqual({
      state: 'waiting',
      text: 'Draft: not ready to merge',
    });
  });

  it('reports no checks as unknown, not as passing', () => {
    expect(readiness(PR).rows.find((row) => row.id === 'checks')).toMatchObject(
      { state: 'unknown', text: 'No checks reported' }
    );
  });
});
