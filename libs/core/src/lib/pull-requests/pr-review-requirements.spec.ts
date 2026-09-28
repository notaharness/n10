import { describe, expect, it } from 'vitest';
import type {
  BranchRules,
  DetailReviewer,
  PullRequestDetail,
  PullRequestInfo,
  ReadOutcome,
  ReviewRule,
} from '@n10/vcs-core';
import {
  asksViewer,
  reviewRequirements,
  ruleLines,
} from './pr-review-requirements.js';

/**
 * Who must review, from constructed detail reads shaped as each
 * provider fills them: Azure DevOps marks everyone required or optional
 * and names policy reviewers by identity id; GitHub marks no one, and
 * says only whether a request went to a code owner.
 */

function reviewer(over: Partial<DetailReviewer>): DetailReviewer {
  return {
    kind: 'user',
    identifier: 'someone',
    id: null,
    displayName: 'Someone',
    decision: 'no-response',
    native: null,
    requested: true,
    attention: null,
    required: null,
    reason: null,
    onBehalfOf: [],
    reviewedHead: null,
    ...over,
  };
}

function detail(
  reviewers: DetailReviewer[],
  complete = true
): ReadOutcome<PullRequestDetail> {
  return {
    state: 'read',
    value: {
      reviewers: {
        state: 'read',
        value: complete
          ? { items: reviewers, total: reviewers.length, complete: true }
          : { items: reviewers, total: null, complete: false },
      },
    } as unknown as PullRequestDetail,
  };
}

function rules(reviews: Partial<ReviewRule>): ReadOutcome<BranchRules> {
  return {
    state: 'read',
    value: {
      requiredChecks: [],
      conversationResolution: false,
      reviews: {
        approvals: 0,
        codeOwners: false,
        named: [],
        approvalsMet: null,
        ...reviews,
      },
    },
  };
}

const ROW: PullRequestInfo = {
  id: 42,
  title: 'Add undo',
  sourceBranch: 'undo',
  targetBranch: 'main',
  url: 'https://example.test/pr/42',
  createdByIdentifier: 'alice',
  createdByDisplayName: 'Alice',
  reviewers: [
    { displayName: 'Bob', identifier: 'bob', decision: 'no-response' },
  ],
};

// ── Azure DevOps ────────────────────────────────────────────────────

const RELEASE = reviewer({
  kind: 'team',
  identifier: 'Release Approvers',
  id: 'AAAA-22',
  displayName: 'Release Approvers',
  required: true,
});
const WEB = reviewer({
  kind: 'team',
  identifier: 'Web Reviewers',
  id: 'aaaa-21',
  displayName: 'Web Reviewers',
  required: true,
});
const BEN = reviewer({
  identifier: 'ben@contoso.test',
  id: 'aaaa-02',
  displayName: 'Ben Ode',
  required: false,
});
const ELI = reviewer({
  identifier: 'eli@contoso.test',
  id: 'aaaa-05',
  displayName: 'Eli Park',
  required: false,
});
const QA = reviewer({
  identifier: 'qa@contoso.test',
  id: 'aaaa-09',
  displayName: 'Quinn Ames',
  required: true,
});
const OPS = reviewer({
  identifier: 'ops@contoso.test',
  id: 'aaaa-10',
  displayName: 'Ola Soto',
  required: true,
});

const AZURE_RULE = rules({
  approvals: 2,
  named: [
    {
      name: 'Required reviewers',
      ids: ['aaaa-22'],
      kind: 'identity',
      approvals: 1,
      paths: ['/release/*'],
      applies: true,
      blocking: true,
    },
    {
      name: 'Required reviewers',
      ids: ['aaaa-02', 'aaaa-10'],
      kind: 'identity',
      approvals: null,
      paths: [],
      applies: true,
      blocking: false,
    },
    // Its paths match no change here: it asks nothing now, but it is
    // what made Web Reviewers required.
    {
      name: 'Required reviewers',
      ids: ['aaaa-21'],
      kind: 'identity',
      approvals: null,
      paths: ['/docs/*'],
      applies: false,
      blocking: true,
    },
  ],
});

describe('reviewRequirements on Azure DevOps', () => {
  it('says who is required, and why only where a policy that applies says so', () => {
    const got = reviewRequirements(
      detail([RELEASE, WEB, BEN, ELI, QA, OPS]),
      AZURE_RULE
    );
    expect(
      got.reviewers.state === 'read' &&
        got.reviewers.value.items.map((r) => [
          r.displayName,
          r.requirement,
          r.reason,
        ])
    ).toEqual([
      // Named by a blocking policy; the id compares ignoring case.
      ['Release Approvers', 'required', 'policy'],
      // Named by a blocking policy that no longer applies: it may not
      // be what added them.
      ['Web Reviewers', 'required', null],
      // Added as optional by a policy that does not block.
      ['Ben Ode', 'optional', 'policy'],
      ['Eli Park', 'optional', null],
      // Required, and named by no policy: by hand, or by a policy
      // since disabled. The history would say; it is not read.
      ['Quinn Ames', 'required', null],
      // Required, where only an optional policy names them.
      ['Ola Soto', 'required', null],
    ]);
  });

  it('puts the rule in words, naming the reviewers a policy requires where it applies', () => {
    expect(
      reviewRequirements(detail([RELEASE, BEN, WEB]), AZURE_RULE).rule
    ).toEqual([
      '2 approvals required',
      '1 approval from Release Approvers (/release/*)',
    ]);
  });

  it('knows no reason for a required reviewer when the policies were not read', () => {
    const got = reviewRequirements(detail([WEB]), {
      state: 'failed',
      kind: 'network',
      reason: 'offline',
    });
    expect(got.rule).toBeNull();
    expect(got.reviewers).toMatchObject({
      state: 'read',
      value: { items: [{ requirement: 'required', reason: null }] },
    });
  });
});

// ── GitHub ──────────────────────────────────────────────────────────

describe('reviewRequirements on GitHub', () => {
  it('leaves everyone’s requirement unknown, and names a code owner', () => {
    const owner = reviewer({ identifier: 'cam', reason: 'code-owner' });
    const asked = reviewer({ identifier: 'dee' });
    const got = reviewRequirements(
      detail([owner, asked]),
      rules({ approvals: 1, codeOwners: true })
    );
    expect(
      got.reviewers.state === 'read' &&
        got.reviewers.value.items.map((r) => [r.requirement, r.reason])
    ).toEqual([
      ['unknown', 'code-owner'],
      // Asked, and nothing more: GitHub marks no one required.
      ['unknown', null],
    ]);
    expect(got.rule).toEqual([
      '1 approval required',
      'Code owners must approve',
    ]);
  });

  it('counts a required team it cannot name', () => {
    expect(
      ruleLines(
        {
          approvals: 0,
          codeOwners: false,
          named: [
            {
              name: null,
              ids: ['777'],
              kind: 'team',
              approvals: 2,
              paths: ['src/**'],
              applies: null,
              blocking: true,
            },
            {
              name: null,
              ids: ['1', '2'],
              kind: 'team',
              approvals: null,
              paths: [],
              applies: null,
              blocking: true,
            },
            // A minimum of 0: added, not required.
            {
              name: null,
              ids: ['3'],
              kind: 'team',
              approvals: 0,
              paths: [],
              applies: null,
              blocking: false,
            },
          ],
          approvalsMet: null,
        },
        []
      )
    ).toEqual([
      '2 approvals from a required team (src/**)',
      '2 required teams must approve',
    ]);
  });

  it('says nothing where the rules ask nothing', () => {
    expect(reviewRequirements(detail([]), rules({})).rule).toEqual([]);
  });

  it('passes on a detail read that failed', () => {
    const failed = { state: 'failed', kind: 'network', reason: 'x' } as const;
    expect(reviewRequirements(failed, rules({})).reviewers).toBe(failed);
  });
});

// ── Whose review is awaited ─────────────────────────────────────────

describe('asksViewer', () => {
  it('does not wait on an optional reviewer whose approval counts toward nothing', () => {
    const bob = reviewer({ identifier: 'Bob', required: false });
    // Only a required reviewer's approval is missing.
    expect(asksViewer(ROW, 'bob', detail([bob]), rules({}))).toBe(false);
    // Under a minimum-approvals policy anyone's approval counts, until
    // Azure says the minimum is met.
    expect(asksViewer(ROW, 'bob', detail([bob]), rules({ approvals: 2 }))).toBe(
      true
    );
    expect(
      asksViewer(
        ROW,
        'bob',
        detail([bob]),
        rules({ approvals: 2, approvalsMet: true })
      )
    ).toBe(false);
  });

  it('waits on an optional reviewer who may answer for a required group', () => {
    const bob = reviewer({ identifier: 'bob', required: false });
    const group = (decision: DetailReviewer['decision']) =>
      reviewer({ kind: 'team', identifier: 'Web', required: true, decision });
    // Membership is not read: their vote may be the group's.
    expect(
      asksViewer(ROW, 'bob', detail([bob, group('no-response')]), rules({}))
    ).toBe(true);
    expect(
      asksViewer(ROW, 'bob', detail([bob, group('approved')]), rules({}))
    ).toBe(false);
  });

  it('waits on a required reviewer, and on one GitHub asked', () => {
    const required = reviewer({ identifier: 'bob', required: true });
    expect(asksViewer(ROW, 'bob', detail([required]), rules({}))).toBe(true);
    const asked = reviewer({ identifier: 'bob' });
    expect(asksViewer(ROW, 'bob', detail([asked]), rules({}))).toBe(true);
  });

  it('takes the asking where the rules are not known', () => {
    const bob = reviewer({ identifier: 'bob', required: false });
    const unread = { state: 'failed', kind: 'network', reason: 'x' } as const;
    expect(asksViewer(ROW, 'bob', detail([bob]), unread)).toBe(true);
  });

  it('falls back to the list row where the detail does not name the viewer', () => {
    const failed = { state: 'failed', kind: 'network', reason: 'x' } as const;
    expect(asksViewer(ROW, 'bob', failed, rules({}))).toBe(true);
    expect(asksViewer(ROW, 'bob', detail([], false), rules({}))).toBe(true);
  });

  it('never waits on an approval already given, or on a draft', () => {
    const approved = reviewer({
      identifier: 'bob',
      required: true,
      decision: 'approved',
    });
    expect(asksViewer(ROW, 'bob', detail([approved]), rules({}))).toBe(false);
    const required = reviewer({ identifier: 'bob', required: true });
    expect(
      asksViewer({ ...ROW, isDraft: true }, 'bob', detail([required]), null)
    ).toBe(false);
  });
});
