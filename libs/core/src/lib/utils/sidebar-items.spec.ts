import { describe, it, expect } from 'vitest';
import type { PullRequestInfo, CategorizedReviews } from '@n10/vcs-core';
import type { AgentSession, SidebarItem } from '../types.js';
import { buildSidebarItems, sidebarSection } from './sidebar-items.js';

function makePr(
  overrides: Partial<PullRequestInfo> & { id: number }
): PullRequestInfo {
  return {
    title: `PR #${overrides.id}`,
    sourceBranch: `feature/branch-${overrides.id}`,
    targetBranch: 'main',
    url: '',
    createdByIdentifier: 'me@test.com',
    createdByDisplayName: 'Me',
    ...overrides,
  };
}

/** No pull request is the viewer's. */
const NOT_YOURS: ReadonlySet<number> = new Set();

const emptyReviews: CategorizedReviews = {
  needsReview: [],
  waitingForAuthor: [],
  approvedByYou: [],
};

describe('buildSidebarItems', () => {
  it('emits no-PR sessions before PR-backed sessions with branch/PR/merge/conflict info', () => {
    const sessions: AgentSession[] = [
      { name: 'feature-foo', running: true, branch: 'feature/foo' },
      { name: 'feature-bar', running: false, branch: 'feature/bar' },
    ];
    const pr = makePr({ id: 1 });
    const sessionPrMap = new Map([['feature-foo', pr]]);
    const mergedBranches = new Set(['feature/bar']);
    const conflictCounts = new Map([['feature/foo', 3]]);

    const items = buildSidebarItems(
      sessions,
      [],
      emptyReviews,
      sessionPrMap,
      new Set([1]),
      mergedBranches,
      conflictCounts
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      kind: 'session',
      session: sessions[1],
      pr: undefined,
      branch: 'feature/bar',
      isMerged: true,
      conflictCount: undefined,
    });
    expect(items[1]).toEqual({
      kind: 'session',
      session: sessions[0],
      pr,
      authored: true,
      branch: 'feature/foo',
      isMerged: false,
      conflictCount: 3,
    });
  });

  it('splits PR-backed sessions into draft and active buckets', () => {
    const sessions: AgentSession[] = [
      { name: 'feature-active', running: true, branch: 'feature/active' },
      { name: 'feature-draft', running: true, branch: 'feature/draft' },
      { name: 'feature-local', running: false, branch: 'feature/local' },
    ];
    const activePr = makePr({ id: 40, isDraft: false });
    const draftPr = makePr({ id: 41, isDraft: true });
    const sessionPrMap = new Map([
      ['feature-active', activePr],
      ['feature-draft', draftPr],
    ]);

    const items = buildSidebarItems(
      sessions,
      [],
      emptyReviews,
      sessionPrMap,
      new Set([40, 41]),
      new Set(),
      new Map()
    );

    expect(
      items.map((i) => (i.kind === 'session' ? i.session.name : i.kind))
    ).toEqual(['feature-local', 'feature-draft', 'feature-active']);
  });

  it('places draft orphan PRs before active orphan PRs', () => {
    const activePr = makePr({ id: 10, isDraft: false });
    const draftPr = makePr({ id: 11, isDraft: true });

    const items = buildSidebarItems(
      [],
      [activePr, draftPr],
      emptyReviews,
      new Map(),
      NOT_YOURS,
      new Set(),
      new Map()
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ kind: 'orphan-pr', pr: draftPr });
    expect(items[1]).toEqual({ kind: 'orphan-pr', pr: activePr });
    // No worktree has an orphan's branch, so the item names no session.
    expect(items.some((i) => 'sessionName' in i || 'running' in i)).toBe(false);
  });

  it('places review PRs after orphans in category order', () => {
    const needsReview = makePr({ id: 20 });
    const waiting = makePr({ id: 21 });
    const approved = makePr({ id: 22 });

    const reviews: CategorizedReviews = {
      needsReview: [needsReview],
      waitingForAuthor: [waiting],
      approvedByYou: [approved],
    };

    const items = buildSidebarItems(
      [],
      [],
      reviews,
      new Map(),
      NOT_YOURS,
      new Set(),
      new Map()
    );

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      kind: 'review-pr',
      pr: needsReview,
      category: 'needs-review',
    });
    expect(items[1]).toEqual({
      kind: 'review-pr',
      pr: waiting,
      category: 'waiting',
    });
    expect(items[2]).toEqual({
      kind: 'review-pr',
      pr: approved,
      category: 'approved',
    });
  });

  it('lists a session under review only in its review row, which carries it', () => {
    const session: AgentSession = {
      name: 'wt-review',
      running: true,
      branch: 'feature/branch-7',
    };
    const review = makePr({ id: 7 });

    const items = buildSidebarItems(
      [session],
      [],
      { needsReview: [review], waitingForAuthor: [], approvedByYou: [] },
      new Map(),
      NOT_YOURS,
      new Set(),
      new Map()
    );

    expect(items).toEqual([
      {
        kind: 'review-pr',
        pr: review,
        category: 'needs-review',
        running: true,
        sessionName: 'wt-review',
      },
    ]);
  });

  it('files a checkout of someone else’s pull request by review state, never under your pull requests', () => {
    // Reviewed or not, someone else's pull request is not yours: a
    // worktree on it with an agent running stays in its review section,
    // or files with the worktrees when no review section lists it — your
    // review request was withdrawn, a teammate answered your team's, or
    // you were never asked.
    const sessions: AgentSession[] = [
      { name: 'wt-review', running: true, branch: 'feature/branch-7' },
      { name: 'wt-theirs', running: true, branch: 'feature/branch-8' },
      { name: 'wt-draft', running: false, branch: 'feature/branch-9' },
    ];
    const review = makePr({ id: 7, createdByIdentifier: 'alex' });
    const theirs = makePr({ id: 8, createdByIdentifier: 'alex' });
    const theirDraft = makePr({
      id: 9,
      createdByIdentifier: 'alex',
      isDraft: true,
    });

    const items = buildSidebarItems(
      sessions,
      [],
      { needsReview: [review], waitingForAuthor: [], approvedByYou: [] },
      new Map([
        ['wt-review', review],
        ['wt-theirs', theirs],
        ['wt-draft', theirDraft],
      ]),
      NOT_YOURS,
      new Set(),
      new Map()
    );

    expect(items.map((i) => [i.pr?.id, sidebarSection(i)])).toEqual([
      [8, 'worktrees'],
      [9, 'worktrees'],
      [7, 'needs-review'],
    ]);
    // The row keeps its pull request and its agent.
    expect(items[0]).toMatchObject({ kind: 'session', pr: theirs });
    expect(items[2]).toMatchObject({ running: true, sessionName: 'wt-review' });
  });

  it('combines all sections in the correct order', () => {
    const session: AgentSession = { name: 'my-session', running: true };
    const orphan = makePr({ id: 5 });
    const review = makePr({ id: 30 });

    const items = buildSidebarItems(
      [session],
      [orphan],
      { needsReview: [review], waitingForAuthor: [], approvedByYou: [] },
      new Map(),
      NOT_YOURS,
      new Set(),
      new Map()
    );

    expect(items.map((i) => i.kind)).toEqual([
      'session',
      'orphan-pr',
      'review-pr',
    ]);
  });

  it('puts a babysat pull request’s status on its row, whichever kind the row is', () => {
    // The desktop row wears its badge from the item, so a babysat pull
    // request has to carry the status whether it is a worktree row, an
    // orphan or a review — and a row that is not babysat has no key at
    // all, so the item's shape says what it carries.
    const session: AgentSession = {
      name: 'feature-branch-1',
      running: true,
      branch: 'feature/branch-1',
    };
    const watched = makePr({ id: 1 });
    const orphan = makePr({ id: 2 });
    const review = makePr({ id: 3 });
    const status = (prId: number) => ({
      prId,
      sourceBranch: `feature/branch-${prId}`,
      phase: 'pending' as const,
      held: null,
      lastPolledAt: 1,
      pendingSince: 1,
      lastDeliveredAt: null,
      deliveries: 0,
      lastError: null,
    });
    const babysat = new Map([
      [1, status(1)],
      [3, status(3)],
    ]);

    const items = buildSidebarItems(
      [session],
      [orphan],
      { needsReview: [review], waitingForAuthor: [], approvedByYou: [] },
      new Map([['feature-branch-1', watched]]),
      NOT_YOURS,
      new Set(),
      new Map(),
      babysat
    );

    expect(items.map((i) => i.babysit?.prId)).toEqual([1, undefined, 3]);
    expect('babysit' in items[1]).toBe(false);
  });

  it('returns empty array when all inputs are empty', () => {
    const items = buildSidebarItems(
      [],
      [],
      emptyReviews,
      new Map(),
      NOT_YOURS,
      new Set(),
      new Map()
    );
    expect(items).toEqual([]);
  });
});

describe('sidebarSection', () => {
  const session = (over: Partial<SidebarItem & { kind: 'session' }> = {}) =>
    ({
      kind: 'session',
      session: { name: 'wt', running: false },
      isMerged: false,
      ...over,
    } as SidebarItem);

  it('files a worktree on your pull request by that pull request', () => {
    expect(sidebarSection(session())).toBe('worktrees');
    expect(
      sidebarSection(session({ pr: makePr({ id: 1 }), authored: true }))
    ).toBe('pull-requests');
    expect(
      sidebarSection(
        session({ pr: makePr({ id: 1, isDraft: true }), authored: true })
      )
    ).toBe('draft-pull-requests');
  });

  it('files a worktree on someone else’s pull request with the worktrees', () => {
    expect(sidebarSection(session({ pr: makePr({ id: 1 }) }))).toBe(
      'worktrees'
    );
    expect(
      sidebarSection(session({ pr: makePr({ id: 1, isDraft: true }) }))
    ).toBe('worktrees');
  });

  it('files a review PR under the category it was sorted into', () => {
    const pr = makePr({ id: 1 });
    expect(
      sidebarSection({ kind: 'review-pr', pr, category: 'needs-review' })
    ).toBe('needs-review');
    expect(
      sidebarSection({ kind: 'review-pr', pr, category: 'approved' })
    ).toBe('approved');
  });

  it('sends a draft orphan PR to the draft section', () => {
    expect(sidebarSection({ kind: 'orphan-pr', pr: makePr({ id: 1 }) })).toBe(
      'pull-requests'
    );
    expect(
      sidebarSection({
        kind: 'orphan-pr',
        pr: makePr({ id: 1, isDraft: true }),
      })
    ).toBe('draft-pull-requests');
  });
});
