import { describe, expect, it } from 'vitest';
import {
  VcsError,
  type PullRequestChecks,
  type PullRequestDetail,
  type PullRequestInfo,
  type PullRequestRef,
  type ReviewRule,
} from '@n10/vcs-core';
import { readPullRequestChecks, type ChecksSources } from './pr-checks-read.js';
import { PullRequestIdentityError } from './pr-snapshot.js';

const NO_RULE: ReviewRule = {
  approvals: 0,
  codeOwners: false,
  named: [],
  approvalsMet: null,
};

const HEAD = '1'.repeat(40);
const REPO = { provider: 'github', host: 'github.com', repository: 'acme/app' };
const REF: PullRequestRef = { ...REPO, number: 42 };

const ROW: PullRequestInfo = {
  id: 42,
  title: 'Add undo',
  sourceBranch: 'undo',
  targetBranch: 'main',
  url: 'https://github.com/acme/app/pull/42',
  createdByIdentifier: 'alice',
  createdByDisplayName: 'Alice',
  activeCommentCount: 2,
};

function answer(over: Partial<PullRequestChecks> = {}): PullRequestChecks {
  return {
    ref: REF,
    head: HEAD,
    checks: { state: 'read', value: { items: [], total: 0, complete: true } },
    rules: {
      state: 'read',
      value: {
        requiredChecks: [],
        conversationResolution: true,
        reviews: NO_RULE,
      },
    },
    merge: {
      lifecycle: { state: 'open', isDraft: false, native: 'OPEN' },
      conflicts: 'none',
      behind: false,
      blocked: true,
      reviews: 'approved',
      conversations: null,
      native: 'BLOCKED',
    },
    ...over,
  };
}

function sources(over: Partial<ChecksSources> = {}): ChecksSources {
  return {
    repository: () => REPO,
    viewer: () => 'bob',
    lookup: () => Promise.resolve({ kind: 'found', pr: ROW }),
    checks: () => Promise.resolve(answer()),
    now: () => 1000,
    ...over,
  };
}

describe('readPullRequestChecks', () => {
  it('makes a review still to come the viewer’s where the provider asks them', async () => {
    const required = answer({
      merge: { ...answer().merge, reviews: 'required' },
    });
    const withReviewers = (
      reviewers: PullRequestInfo['reviewers'],
      isDraft = false
    ) =>
      sources({
        checks: () => Promise.resolve(required),
        lookup: () =>
          Promise.resolve({
            kind: 'found',
            pr: { ...ROW, reviewers, isDraft },
          }),
      });
    const resolver = async (
      reviewers: PullRequestInfo['reviewers'],
      isDraft?: boolean
    ) =>
      (
        await readPullRequestChecks(
          { ref: REF, viewer: 'bob' },
          withReviewers(reviewers, isDraft)
        )
      ).readiness.blockers.find((b) => b.kind === 'reviews')?.resolvedBy;
    const bob = { identifier: 'Bob', displayName: 'Bob' };
    expect(await resolver([{ ...bob, decision: 'no-response' }])).toBe(
      'viewer'
    );
    // Asked again after holding it: their next review is what is missing.
    expect(
      await resolver([
        { ...bob, decision: 'changes-requested', requested: true },
      ])
    ).toBe('viewer');
    // Asked again after approving: the approval already counts.
    expect(
      await resolver([{ ...bob, decision: 'approved', requested: true }])
    ).toBe('reviewers');
    // Not asked: someone else is, or they declined.
    expect(
      await resolver([
        { identifier: 'cy', displayName: 'Cy', decision: 'no-response' },
      ])
    ).toBe('reviewers');
    expect(await resolver([{ ...bob, decision: 'declined' }])).toBe(
      'reviewers'
    );
    // Only commented, where the list says who was asked.
    expect(
      await resolver([{ ...bob, decision: 'no-response', requested: false }])
    ).toBe('reviewers');
    // A draft asks no one yet.
    expect(await resolver([{ ...bob, decision: 'no-response' }], true)).toBe(
      'reviewers'
    );
  });

  it('asks the detail read whether the viewer’s review would count', async () => {
    const required = answer({
      merge: { ...answer().merge, reviews: 'required' },
    });
    // The list row asks Bob; the detail says his vote is optional, and
    // no rule counts anyone's approval: someone else's is missing.
    const detail = (isRequired: boolean) =>
      Promise.resolve({
        ref: REF,
        reviewers: {
          state: 'read' as const,
          value: {
            items: [
              {
                kind: 'user' as const,
                identifier: 'bob',
                id: 'id-bob',
                displayName: 'Bob',
                decision: 'no-response' as const,
                native: '0',
                requested: true,
                attention: false,
                required: isRequired,
                reason: null,
                onBehalfOf: [],
                reviewedHead: null,
              },
            ],
            total: 1,
            complete: true as const,
          },
        },
      } as unknown as PullRequestDetail);
    const read = (isRequired: boolean) =>
      readPullRequestChecks(
        { ref: REF, viewer: 'bob' },
        sources({
          checks: () => Promise.resolve(required),
          lookup: () =>
            Promise.resolve({
              kind: 'found',
              pr: {
                ...ROW,
                reviewers: [
                  {
                    identifier: 'bob',
                    displayName: 'Bob',
                    decision: 'no-response',
                  },
                ],
              },
            }),
          detail: () => detail(isRequired),
        })
      );
    const resolver = async (isRequired: boolean) =>
      (await read(isRequired)).readiness.blockers.find(
        (b) => b.kind === 'reviews'
      )?.resolvedBy;
    expect(await resolver(false)).toBe('reviewers');
    expect(await resolver(true)).toBe('viewer');
    // And the answer carries each reviewer's standing.
    expect((await read(true)).requirements).toMatchObject({
      reviewers: {
        state: 'read',
        value: { items: [{ identifier: 'bob', requirement: 'required' }] },
      },
    });
  });

  it('evaluates readiness with the list row’s unresolved conversations', async () => {
    const res = await readPullRequestChecks(
      { ref: REF, viewer: 'bob' },
      sources()
    );
    expect(res).toMatchObject({
      ref: REF,
      viewer: 'bob',
      fetchedAt: 1000,
      list: { rows: [], total: 0, complete: true },
    });
    // Two unresolved threads and a rule that they be resolved: the
    // provider's BLOCKED is named, not a rule n10 cannot see.
    expect(res.readiness?.blockers).toEqual([
      {
        kind: 'conversations',
        text: '2 unresolved conversations',
        resolvedBy: 'author',
      },
    ]);
  });

  it('refuses a pull request outside the open repository, or another account', async () => {
    await expect(
      readPullRequestChecks(
        { ref: { ...REF, repository: 'acme/other' } },
        sources()
      )
    ).rejects.toBeInstanceOf(PullRequestIdentityError);
    await expect(
      readPullRequestChecks({ ref: REF, viewer: 'carol' }, sources())
    ).rejects.toThrow('n10 acts as bob now, not carol');
  });

  it('refuses an answer read after the account changed under it', async () => {
    let who = 'bob';
    const read = readPullRequestChecks(
      { ref: REF },
      sources({
        viewer: () => who,
        checks: () => {
          who = 'carol';
          return Promise.resolve(answer());
        },
      })
    );
    await expect(read).rejects.toBeInstanceOf(PullRequestIdentityError);
  });

  it('refuses a repository replaced at the same path, and returns only the id the provider gave', async () => {
    const answering = (id?: string) =>
      sources({
        checks: () =>
          Promise.resolve(answer({ ref: { ...REF, ...(id ? { id } : {}) } })),
      });
    await expect(
      readPullRequestChecks({ ref: { ...REF, id: '1' } }, answering('2'))
    ).rejects.toThrow('is now a different repository');

    const confirmed = await readPullRequestChecks({ ref: REF }, answering('9'));
    expect(confirmed.ref.id).toBe('9');
    const unconfirmed = await readPullRequestChecks(
      { ref: { ...REF, id: '9' } },
      answering()
    );
    expect(unconfirmed.ref).not.toHaveProperty('id');
  });

  it('refuses a detail read about another repository than the checks read', async () => {
    // Asked with no id, the two parallel reads answer about repositories
    // with different ids: one was replaced between them.
    const read = readPullRequestChecks(
      { ref: REF },
      sources({
        checks: () => Promise.resolve(answer({ ref: { ...REF, id: '2' } })),
        detail: () =>
          Promise.resolve({
            ref: { ...REF, id: '3' },
            reviewers: {
              state: 'read',
              value: { items: [], total: 0, complete: true },
            },
          } as unknown as PullRequestDetail),
      })
    );
    await expect(read).rejects.toThrow('is now a different repository');
  });

  it('does not take checks about another pull request for this one', async () => {
    const res = await readPullRequestChecks(
      { ref: REF },
      sources({
        checks: () => Promise.resolve(answer({ ref: { ...REF, number: 43 } })),
      })
    );
    expect(res.checks).toMatchObject({ state: 'failed' });
    // Readiness falls back to the list row, and so is not fully known;
    // the row still says it is open, and its unresolved threads.
    expect(res.readiness.state).toBe('unknown');
    expect(res.readiness.aspects).toContainEqual({
      id: 'lifecycle',
      state: 'met',
      text: 'Open',
    });
    expect(res.readiness.aspects).toContainEqual({
      id: 'conversations',
      state: 'observed',
      text: '2 unresolved, not known if required',
    });
    expect(res.list).toBeNull();
  });

  it('keeps a failed read’s kind, and says a provider without checks has none to read', async () => {
    const failed = await readPullRequestChecks(
      { ref: REF },
      sources({
        checks: () =>
          Promise.reject(
            new VcsError('throttled', 'slow down', { retryAfterMs: 5000 })
          ),
      })
    );
    expect(failed.checks).toEqual({
      state: 'failed',
      kind: 'throttled',
      reason: 'slow down',
      retryAfterMs: 5000,
    });
    const none = await readPullRequestChecks(
      { ref: REF },
      sources({ checks: undefined })
    );
    expect(none.checks.state).toBe('unsupported');
  });
});
