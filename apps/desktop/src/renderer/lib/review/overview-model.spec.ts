import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
  activeReviewers,
  adoptPullRequest,
  backTarget,
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
  it('goes to the pane last shown, or else where the review starts', () => {
    expect(backToReviewPane('diff', true)).toBe('diff');
    expect(backToReviewPane('overview', true)).toBe('overview');
    // Straight into the terminal: the Overview, when there is one.
    expect(backToReviewPane(null, true)).toBe('overview');
    expect(backToReviewPane(null, false)).toBe('diff');
  });
});

describe('backTarget', () => {
  it('goes up from the changes to the Overview, the top of the review', () => {
    expect(backTarget('diff', 'diff')).toBe('overview');
    expect(backTarget('overview', 'diff')).toBeNull();
  });

  it('goes up from the terminal, the plan and the walkthrough to the review pane last shown', () => {
    for (const mode of ['agent', 'plan', 'review'] as const) {
      expect(backTarget(mode, 'diff')).toBe('diff');
      expect(backTarget(mode, 'overview')).toBe('overview');
    }
  });
});

describe('initialMode', () => {
  it('opens every pull request on its Overview, yours included', () => {
    expect(initialMode({ running: false, hasPr: true })).toBe('overview');
  });

  it('opens a bare worktree, which has no Overview, on the diff', () => {
    expect(initialMode({ running: false, hasPr: false })).toBe('diff');
  });

  it('opens on a running agent', () => {
    expect(initialMode({ running: true, hasPr: true })).toBe('agent');
    expect(initialMode({ running: true, hasPr: false })).toBe('agent');
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
  it('asks a reviewer to review the changes, and only to view a draft’s', () => {
    expect(nextStep(PR, 'reviewer')).toEqual({
      action: 'review-changes',
      label: 'Review changes',
    });
    expect(nextStep({ ...PR, isDraft: true }, 'reviewer')).toEqual({
      action: 'review-changes',
      label: 'View changes',
    });
  });

  it('sends an author with unresolved threads to them, else to the changes', () => {
    expect(nextStep({ ...PR, activeCommentCount: 2 }, 'author')).toEqual({
      action: 'show-unresolved',
      label: 'Respond to feedback',
    });
    expect(nextStep(PR, 'author')).toEqual({
      action: 'review-changes',
      label: 'View changes',
    });
  });

  it('leads a reviewer to the changes whatever is unresolved', () => {
    expect(nextStep({ ...PR, activeCommentCount: 2 }, 'reviewer').action).toBe(
      'review-changes'
    );
  });
});

describe('activeReviewers', () => {
  it('counts one row per vote, and nobody who declined', () => {
    const team = {
      identifier: 'core-team',
      displayName: 'Core Team',
      decision: 'approved' as const,
    };
    const teammate = { ...bea('approved'), votedFor: ['core-team'] };
    const cy = {
      identifier: 'cy',
      displayName: 'Cy',
      decision: 'declined' as const,
    };
    expect(activeReviewers([team, teammate, cy])).toEqual([teammate]);
  });
});
