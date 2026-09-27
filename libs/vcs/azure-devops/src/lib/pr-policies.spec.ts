import { describe, expect, it } from 'vitest';
import {
  conversationsOf,
  isListed,
  POLICY,
  policiesBlock,
  policyCheck,
  reviewersBlock,
  reviewsOf,
  rulesOf,
  type RawEvaluation,
} from './pr-policies.js';

/**
 * Branch policies as Azure DevOps evaluates them, from constructed
 * records in the shape its policy evaluations API returns.
 */

const WHERE = { org: 'contoso', project: 'Fabrikam' };
const OLD = 'a'.repeat(40);

function evaluation(
  type: string,
  status: string,
  over: {
    blocking?: boolean;
    enabled?: boolean;
    deleted?: boolean;
    settings?: NonNullable<RawEvaluation['configuration']>['settings'];
    context?: RawEvaluation['context'];
    id?: number;
  } = {}
): RawEvaluation {
  return {
    evaluationId: `ev-${over.id ?? 1}`,
    status,
    startedDate: '2026-09-26T10:00:00Z',
    completedDate: status === 'running' ? undefined : '2026-09-26T10:04:00Z',
    configuration: {
      id: over.id ?? 1,
      isEnabled: over.enabled ?? true,
      isBlocking: over.blocking ?? true,
      isDeleted: over.deleted ?? false,
      type: { id: type, displayName: DISPLAY[type] },
      settings: over.settings ?? {},
    },
    context: over.context,
  };
}

const DISPLAY: Record<string, string> = {
  [POLICY.build]: 'Build',
  [POLICY.status]: 'Status',
  [POLICY.minimumReviewers]: 'Minimum number of reviewers',
  [POLICY.requiredReviewers]: 'Required reviewers',
  [POLICY.comments]: 'Comment requirements',
  'work-items': 'Work item linking',
};

const BUILD = (status: string, context: RawEvaluation['context'] = {}) =>
  evaluation(POLICY.build, status, {
    id: 7,
    settings: { displayName: 'PR build' },
    context: { buildId: 812, buildDefinitionName: 'ci', ...context },
  });

describe('policyCheck', () => {
  it('reads a build policy as a check on the merge, with its build', () => {
    expect(
      policyCheck(BUILD('rejected', { lastMergeSourceCommitId: OLD }), WHERE)
    ).toEqual({
      key: 'policy:7:812',
      kind: 'check',
      requires: null,
      name: 'PR build',
      group: 'Build',
      source: 'Azure Pipelines',
      outcome: 'failed',
      native: 'rejected',
      requirement: 'required',
      // The source commit this build merged: an earlier push's, maybe.
      revision: OLD,
      ranOn: 'merge',
      startedAt: '2026-09-26T10:00:00Z',
      completedAt: '2026-09-26T10:04:00Z',
      attempt: null,
      url: 'https://dev.azure.com/contoso/Fabrikam/_build/results?buildId=812',
    });
  });

  it('keeps every evaluation status apart, and an expired approval is not a pass', () => {
    const outcome = (e: RawEvaluation) => {
      const c = policyCheck(e, WHERE);
      return [c.outcome, c.native];
    };
    expect(
      [
        BUILD('queued'),
        BUILD('running'),
        BUILD('approved'),
        BUILD('approved', { isExpired: true }),
        BUILD('notApplicable'),
        BUILD('broken'),
        BUILD('somethingNew'),
      ].map(outcome)
    ).toEqual([
      ['queued', 'queued'],
      ['running', 'running'],
      ['succeeded', 'approved'],
      ['queued', 'expired'],
      ['skipped', 'notApplicable'],
      ['failed', 'broken'],
      ['unknown', 'somethingNew'],
    ]);
  });

  it('says a build with a manual trigger waits for someone to queue it', () => {
    const manual = (status: string) =>
      policyCheck(
        evaluation(POLICY.build, status, {
          settings: { manualQueueOnly: true },
          context: { buildDefinitionName: 'nightly' },
        }),
        WHERE
      );
    expect(manual('queued')).toMatchObject({ outcome: 'queued', manual: true });
    // Once queued by someone, it is under way like any other.
    expect(manual('running')).not.toHaveProperty('manual');
    expect(policyCheck(BUILD('queued'), WHERE)).not.toHaveProperty('manual');
  });

  it('names other policies by what they wait for, and runs nothing', () => {
    const status = policyCheck(
      evaluation(POLICY.status, 'queued', {
        blocking: false,
        settings: { statusGenre: 'sonar', statusName: 'quality-gate' },
      }),
      WHERE
    );
    expect(status).toMatchObject({
      name: 'sonar/quality-gate',
      requirement: 'optional',
      source: 'Azure DevOps',
      revision: null,
      ranOn: null,
      url: null,
    });
    expect(
      policyCheck(evaluation('work-items', 'rejected'), WHERE)
    ).toMatchObject({ kind: 'policy', name: 'Work item linking' });
  });
});

describe('the completion gate', () => {
  it('blocks on an unmet blocking policy only', () => {
    expect(policiesBlock([BUILD('approved')])).toBe(false);
    expect(policiesBlock([BUILD('running')])).toBe(true);
    // A build policy that failed, with no failed status anywhere.
    expect(policiesBlock([BUILD('rejected')])).toBe(true);
    expect(policiesBlock([BUILD('approved', { isExpired: true })])).toBe(true);
    // A policy that does not apply to this pull request is met.
    expect(policiesBlock([BUILD('notApplicable')])).toBe(false);
    expect(
      policiesBlock([
        evaluation('work-items', 'rejected', { blocking: false }),
        evaluation(POLICY.comments, 'rejected', { enabled: false }),
        evaluation(POLICY.minimumReviewers, 'rejected', { deleted: true }),
      ])
    ).toBe(false);
  });

  it('reads the rules from the blocking policies', () => {
    expect(
      rulesOf([
        BUILD('approved'),
        evaluation(POLICY.status, 'queued', {
          id: 8,
          settings: { statusGenre: 'sonar', statusName: 'quality-gate' },
        }),
        evaluation(POLICY.status, 'queued', {
          id: 9,
          blocking: false,
          settings: { statusName: 'lint' },
        }),
        evaluation(POLICY.comments, 'rejected', { id: 10 }),
      ])
    ).toEqual({
      // A pipeline's build, or a status by name: no app is named.
      requiredChecks: [
        { name: 'PR build', app: null },
        { name: 'sonar/quality-gate', app: null },
      ],
      conversationResolution: true,
    });
    expect(rulesOf([]).conversationResolution).toBe(false);
  });

  it('reads the review requirement from the reviewer policies and the votes', () => {
    const minimum = (status: string) =>
      evaluation(POLICY.minimumReviewers, status);
    const votes = (...vote: number[]) => vote.map((v) => ({ vote: v }));
    expect(reviewsOf([], [])).toBe('not-required');
    expect(reviewsOf([minimum('approved')], votes(10))).toBe('approved');
    expect(reviewsOf([minimum('rejected')], votes(0, 5))).toBe('required');
    expect(reviewsOf([minimum('rejected')], votes(10, -10))).toBe(
      'changes-requested'
    );
    // Waiting for the author asks for changes too.
    expect(reviewsOf([minimum('queued')], votes(-5))).toBe('changes-requested');
    // A policy Azure does not block on requires nothing.
    expect(
      reviewsOf(
        [evaluation(POLICY.requiredReviewers, 'rejected', { blocking: false })],
        []
      )
    ).toBe('not-required');
  });

  it('counts only the downvotes Azure counts', () => {
    const minimum = (allowDownvotes?: boolean) =>
      evaluation(POLICY.minimumReviewers, 'rejected', {
        settings: allowDownvotes == null ? {} : { allowDownvotes },
      });
    const required = { vote: 0, isRequired: true };
    const rejects = { vote: -10 };
    // A required reviewer has not voted; an optional one's reject is
    // not what Azure waits on.
    expect(reviewsOf([], [required, rejects])).toBe('required');
    expect(reviewsOf([minimum(true)], [rejects])).toBe('required');
    // A required reviewer's downvote, or anyone's under a policy that
    // does not allow them, is changes requested.
    expect(reviewsOf([], [{ vote: -5, isRequired: true }])).toBe(
      'changes-requested'
    );
    expect(reviewsOf([minimum(false)], [rejects])).toBe('changes-requested');
    // Azure's default is to count them.
    expect(reviewsOf([minimum()], [rejects])).toBe('changes-requested');
  });

  it('holds completion for a required reviewer who has not approved', () => {
    const required = (vote: number) => ({ vote, isRequired: true });
    // Approve with suggestions (5) approves; no vote, or waiting, does not.
    expect(reviewersBlock([required(5), { vote: 0 }])).toBe(false);
    expect(reviewersBlock([required(10), required(0)])).toBe(true);
    expect(reviewsOf([], [required(0)])).toBe('required');
    expect(reviewsOf([], [required(-10)])).toBe('changes-requested');
    expect(reviewsOf([], [required(10)])).toBe('approved');
    // Unread policies leave their part unknown, but not a reviewer's.
    expect(reviewsOf(null, [required(10)])).toBe('unknown');
    expect(reviewsOf(null, [required(0)])).toBe('required');
  });

  it('reads the threads’ verdict from a blocking comment policy', () => {
    const comments = (status: string, blocking = true) =>
      evaluation(POLICY.comments, status, { id: 10, blocking });
    expect(conversationsOf([comments('approved')])).toBe('resolved');
    expect(conversationsOf([comments('rejected')])).toBe('unresolved');
    expect(conversationsOf([comments('queued')])).toBeNull();
    expect(conversationsOf([comments('rejected', false)])).toBeNull();
    expect(conversationsOf([])).toBeNull();
    expect(conversationsOf(null)).toBeNull();
  });

  it('lists build, status and other policies, never the reviewer or comment ones', () => {
    const listed = [
      BUILD('approved'),
      evaluation(POLICY.status, 'queued', { id: 8 }),
      evaluation('work-items', 'rejected', { id: 11 }),
      evaluation(POLICY.minimumReviewers, 'approved', { id: 12 }),
      evaluation(POLICY.requiredReviewers, 'approved', { id: 13 }),
      evaluation(POLICY.comments, 'approved', { id: 10 }),
      evaluation('work-items', 'rejected', { id: 14, enabled: false }),
    ]
      .filter(isListed)
      .map((e) => [policyCheck(e, WHERE).key, policyCheck(e, WHERE).kind]);
    expect(listed).toEqual([
      ['policy:7:812', 'check'],
      ['policy:8', 'check'],
      ['policy:11', 'policy'],
    ]);
  });
});
