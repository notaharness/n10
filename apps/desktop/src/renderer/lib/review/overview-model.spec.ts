import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
  adoptPullRequest,
  backToReviewPane,
  initialMode,
  lastReviewPane,
  nextStep,
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

describe('lastReviewPane', () => {
  it('goes up to the review pane the reader was last on, whatever came since', () => {
    expect(lastReviewPane('overview', 'diff')).toBe('diff');
    expect(lastReviewPane('diff', 'overview')).toBe('overview');
    // The terminal, a walkthrough and the plan are not the review.
    for (const mode of ['agent', 'review', 'plan'] as const) {
      expect(lastReviewPane('overview', mode)).toBe('overview');
      expect(lastReviewPane('diff', mode)).toBe('diff');
      expect(lastReviewPane(null, mode)).toBeNull();
    }
  });
});

describe('backToReviewPane', () => {
  it('goes to the pane last shown, or else the one the pull request opens on for the reader', () => {
    expect(backToReviewPane('diff', 'reviewer')).toBe('diff');
    expect(backToReviewPane('overview', 'author')).toBe('overview');
    // Straight into the terminal: the reader's role decides, as it is now.
    expect(backToReviewPane(null, 'reviewer')).toBe('overview');
    expect(backToReviewPane(null, 'author')).toBe('diff');
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

  it('leads a reviewer from the unresolved count to the first open thread', () => {
    const pr = {
      ...PR,
      activeCommentCount: 2,
      reviewers: [bea('no-response')],
    };
    expect(nextStep(pr, 'reviewer', 'bea')).toMatchObject({
      detail: '2 unresolved threads',
      detailAction: 'show-unresolved',
      action: 'review-changes',
    });
    // No account: the detail says so, and leads nowhere.
    expect(nextStep(pr, 'reviewer', null)).not.toHaveProperty('detailAction');
  });

  it('says a review is requested only where the provider asks for it', () => {
    // On GitHub, a reply in a thread lists the reader without a request.
    const pr = {
      ...PR,
      reviewers: [{ ...bea('no-response'), requested: false }],
    };
    expect(nextStep(pr, 'reviewer', 'bea').summary).toBe(
      'Not reviewed by you yet'
    );
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
  });

  it('says what the row shows about reviews, never that one is required', () => {
    // Whether a review is required is the provider's, in Completion.
    expect(nextStep(PR, 'author', 'alex')).toMatchObject({
      summary: 'No reviewers requested',
      detail: null,
    });
    expect(
      nextStep({ ...PR, reviewers: [bea('no-response')] }, 'author', 'alex')
        .summary
    ).toBe('No approvals yet');
  });
});
