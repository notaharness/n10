import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestCheck, PullRequestChecks } from '@n10/vcs-core';
import { fetchPullRequestChecksGitHub } from './pr-checks.js';

/**
 * The GitHub checks read against constructed answers in the shapes
 * GitHub returns: every check with GitHub's own requirement, the base
 * branch's rules, the pages of a long list, and GitHub's reading of
 * mergeability and reviews.
 */

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execSync: vi.fn(),
}));

type Json = Record<string, unknown>;

const HEAD = '1'.repeat(40);
const ACTIONS = { slug: 'github-actions', databaseId: 15368 };
const CIRCLE = { slug: 'circleci-checks', databaseId: 18001 };

/** Each check run's own id: unique, as GitHub's are. */
let nextRun = 1;

function run(
  name: string,
  over: Partial<{
    status: string;
    conclusion: string | null;
    isRequired: boolean | null;
    app: { slug: string; databaseId: number };
    workflow: string;
    event: string;
    /** The check suite: one run of one workflow or app on the head. */
    suite: number;
    /** A third-party app's suite, which has no workflow run. */
    external: boolean;
  }> = {}
): Json {
  return {
    __typename: 'CheckRun',
    databaseId: nextRun++,
    name,
    status: over.status ?? 'COMPLETED',
    conclusion: over.conclusion === undefined ? 'SUCCESS' : over.conclusion,
    startedAt: '2026-09-26T10:00:00Z',
    completedAt: '2026-09-26T10:04:00Z',
    detailsUrl: `https://github.com/acme/app/actions/runs/1/job/${name}`,
    isRequired: over.isRequired === undefined ? true : over.isRequired,
    checkSuite: {
      databaseId: over.suite ?? 1,
      app: over.app ?? ACTIONS,
      workflowRun: over.external
        ? null
        : {
            runAttempt: 2,
            event: over.event ?? 'pull_request',
            workflow: { name: over.workflow ?? 'CI' },
          },
    },
  };
}

function status(
  context: string,
  state: string,
  isRequired: boolean | null
): Json {
  return {
    __typename: 'StatusContext',
    context,
    state,
    targetUrl: 'https://preview.example/42',
    createdAt: '2026-09-26T10:02:00Z',
    creator: { login: 'preview-bot' },
    isRequired,
  };
}

interface PageOf {
  nodes: Json[];
  next?: string;
  oid?: string;
  /** GitHub's count of every check on the head. */
  total?: number;
}

/** One answer of the checks query, or of its contexts page. */
function answer(page: PageOf, pr: Json = {}): Json {
  return {
    data: {
      repository: {
        databaseId: 11223344,
        pullRequest: {
          number: 42,
          state: 'OPEN',
          isDraft: false,
          baseRefName: 'main',
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'BLOCKED',
          reviewDecision: 'REVIEW_REQUIRED',
          baseRef: { refUpdateRule: null },
          ...pr,
          commits: {
            nodes: [
              {
                commit: {
                  oid: page.oid ?? HEAD,
                  statusCheckRollup: {
                    contexts: {
                      totalCount: page.total ?? page.nodes.length,
                      pageInfo: {
                        hasNextPage: page.next != null,
                        endCursor: page.next ?? null,
                      },
                      nodes: page.nodes,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

/** `branches/<name>`: classic protection off unless given. */
function branch(protection: Json | null = null): Json {
  return {
    name: 'main',
    protected: protection != null,
    protection: protection ?? {
      enabled: false,
      required_status_checks: {
        enforcement_level: 'off',
        contexts: [],
        checks: [],
      },
    },
  };
}

function requiredRule(...names: [string, number | null][]): Json {
  return {
    type: 'required_status_checks',
    parameters: {
      required_status_checks: names.map(([context, id]) => ({
        context,
        integration_id: id,
      })),
    },
  };
}

/** A rule that asks nothing of reviews. */
const NO_REVIEWS = {
  approvals: 0,
  codeOwners: false,
  named: [],
  approvalsMet: null,
};

const RESOLUTION_RULE = {
  type: 'pull_request',
  parameters: { required_review_thread_resolution: true },
};

/** What `gh` prints when it fails, in place of an answer. */
interface Failure {
  stderr: string;
}

interface Answers {
  PullRequestChecks: (Json | Failure)[];
  PullRequestCheckContexts?: (Json | Failure)[];
  branch?: Json | Failure;
  rules?: Json[] | Failure;
}

/** Answer each `gh` call: GraphQL by query name, REST by path. */
function answerWith(answers: Answers) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      args: string[],
      cb: (err: unknown, res?: { stdout: string }) => void
    ) => {
      let next: Json | Json[] | Failure | undefined;
      if (args[1] === 'graphql') {
        const query = args.find((a) => a.startsWith('query=')) ?? '';
        const name = /query (\w+)/.exec(query)?.[1] as
          | 'PullRequestChecks'
          | 'PullRequestCheckContexts';
        next = answers[name]?.shift();
      } else if (/\/rules\/branches\//.test(args[1])) {
        next = answers.rules ?? [];
      } else if (/\/branches\//.test(args[1])) {
        next = answers.branch ?? branch();
      }
      if (!next)
        cb({ stderr: `unexpected call ${args.slice(0, 2).join(' ')}` });
      else if ('stderr' in next) cb(next);
      else cb(null, { stdout: JSON.stringify(next) });
    }
  );
}

function calls(): string[][] {
  return (mockExecFile.mock.calls as [string, string[]][]).map(([, a]) => a);
}

function items(res: PullRequestChecks): PullRequestCheck[] {
  if (res.checks.state !== 'read') throw new Error(res.checks.state);
  return res.checks.value.items;
}

const read = () => fetchPullRequestChecksGitHub('acme', 'app', 42);

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('fetchPullRequestChecksGitHub: checks', () => {
  it('reads each check with GitHub’s requirement, in the shared outcomes', async () => {
    answerWith({
      PullRequestChecks: [
        answer({
          nodes: [
            run('build'),
            run('lint', { status: 'IN_PROGRESS', conclusion: null }),
            run('e2e', { conclusion: 'TIMED_OUT', isRequired: false }),
            run('docs', { conclusion: 'SKIPPED', isRequired: false }),
            status('deploy/preview', 'ERROR', null),
          ],
        }),
      ],
    });
    const res = await read();
    // Named by the repository's id as GitHub answered it.
    expect(res.ref).toEqual({
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
      id: '11223344',
      number: 42,
    });
    expect(res.head).toBe(HEAD);
    expect(
      items(res).map((c) => [c.name, c.outcome, c.native, c.requirement])
    ).toEqual([
      ['build', 'succeeded', 'SUCCESS', 'required'],
      ['lint', 'running', 'IN_PROGRESS', 'required'],
      ['e2e', 'failed', 'TIMED_OUT', 'optional'],
      ['docs', 'skipped', 'SKIPPED', 'optional'],
      ['deploy/preview', 'failed', 'ERROR', 'unknown'],
    ]);
    expect(items(res)[0]).toMatchObject({
      kind: 'check',
      group: 'CI',
      source: 'github-actions',
      revision: HEAD,
      // A `pull_request` run tests the head merged into the base.
      ranOn: 'merge',
      attempt: 2,
      url: 'https://github.com/acme/app/actions/runs/1/job/build',
    });
    expect(items(res)[4]).toMatchObject({
      kind: 'check',
      group: null,
      source: 'preview-bot',
      ranOn: null,
      completedAt: '2026-09-26T10:02:00Z',
    });
  });

  it('maps every conclusion and status GitHub gives', async () => {
    const conclusions = [
      'SUCCESS',
      'FAILURE',
      'TIMED_OUT',
      'STARTUP_FAILURE',
      'ACTION_REQUIRED',
      'CANCELLED',
      'STALE',
      'NEUTRAL',
      'SKIPPED',
    ];
    const states = ['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED'];
    answerWith({
      PullRequestChecks: [
        answer({
          nodes: [
            ...conclusions.map((c) => run(c, { conclusion: c })),
            ...states.map((st) => status(st, st, true)),
          ],
        }),
      ],
    });
    const checks = items(await read());
    expect(checks.map((c) => c.outcome)).toEqual([
      'succeeded',
      'failed',
      'failed',
      'failed',
      'failed',
      'cancelled',
      'cancelled',
      'neutral',
      'skipped',
      'succeeded',
      'failed',
      'failed',
      'running',
      'expected',
    ]);
    // Only a settled status says when it settled.
    expect(checks.slice(conclusions.length).map((c) => c.completedAt)).toEqual([
      '2026-09-26T10:02:00Z',
      '2026-09-26T10:02:00Z',
      '2026-09-26T10:02:00Z',
      null,
      null,
    ]);
  });

  it('takes no outcome it does not know for a pass or a failure', async () => {
    answerWith({
      PullRequestChecks: [
        answer({ nodes: [run('build', { conclusion: 'SOMETHING_NEW' })] }),
      ],
    });
    expect(items(await read())[0]).toMatchObject({
      outcome: 'unknown',
      native: 'SOMETHING_NEW',
    });
  });

  it('tells a run waiting for a runner from one waiting on a deployment rule', async () => {
    const going = (status: string) => run(status, { status, conclusion: null });
    answerWith({
      PullRequestChecks: [
        answer({
          nodes: [
            going('QUEUED'),
            going('PENDING'),
            going('WAITING'),
            going('IN_PROGRESS'),
            status('ci/legacy', 'PENDING', true),
          ],
        }),
      ],
    });
    expect(items(await read()).map((c) => c.outcome)).toEqual([
      'queued',
      'queued',
      'waiting',
      'running',
      'running',
    ]);
  });

  it('says which commit GitHub handed a run only where its event says', async () => {
    answerWith({
      PullRequestChecks: [
        answer({
          nodes: [
            run('push', { event: 'push' }),
            run('target', { event: 'pull_request_target' }),
            run('app', { app: CIRCLE, external: true }),
          ],
        }),
      ],
    });
    // A `pull_request_target` run's context is the base, and a
    // third-party app's suite names no event: neither is the head or
    // its test merge by GitHub's word.
    expect(items(await read()).map((c) => c.ranOn)).toEqual([
      'revision',
      null,
      null,
    ]);
  });

  it('tells two apps’, two workflows’, or one workflow’s two runs’ checks of one name apart', async () => {
    answerWith({
      PullRequestChecks: [
        answer({
          nodes: [
            run('build'),
            run('build', { app: CIRCLE, suite: 2 }),
            run('build', { workflow: 'Nightly', suite: 3 }),
            // The same workflow, run for a push and for the pull request.
            run('build', { event: 'push', suite: 4 }),
          ],
        }),
      ],
    });
    const keys = items(await read()).map((c) => c.key);
    expect(new Set(keys).size).toBe(4);
  });

  it('tells two jobs of one name in one run apart', async () => {
    // One workflow run whose two jobs share a display name: one skipped,
    // one passed. Merged, the skip would hide behind the pass.
    answerWith({
      PullRequestChecks: [
        answer({
          nodes: [run('Lint', { conclusion: 'SKIPPED' }), run('Lint')],
        }),
      ],
    });
    const lint = items(await read());
    expect(lint.map((c) => c.outcome)).toEqual(['skipped', 'succeeded']);
    expect(lint[0].key).not.toBe(lint[1].key);
  });
});

describe('fetchPullRequestChecksGitHub: required checks nothing reported', () => {
  it('lists a required check the head has not reported as expected', async () => {
    answerWith({
      PullRequestChecks: [
        answer({ nodes: [run('build', { app: CIRCLE, isRequired: false })] }),
      ],
      // `build` must come from GitHub Actions: CircleCI's does not count.
      rules: [requiredRule(['build', ACTIONS.databaseId], ['e2e', null])],
    });
    const res = await read();
    expect(
      items(res).map((c) => [c.name, c.outcome, c.requirement, c.source])
    ).toEqual([
      ['build', 'succeeded', 'optional', 'circleci-checks'],
      ['build', 'expected', 'required', null],
      ['e2e', 'expected', 'required', null],
    ]);
    // Each expected check carries the requirement it stands for.
    expect(items(res).map((c) => c.requires)).toEqual([
      null,
      { name: 'build', app: { id: '15368', slug: null } },
      { name: 'e2e', app: null },
    ]);
    expect(res.rules).toEqual({
      state: 'read',
      value: {
        requiredChecks: [
          // Its id is GitHub's; the app is named where a check on the
          // head shows which.
          { name: 'build', app: { id: '15368', slug: null } },
          { name: 'e2e', app: null },
        ],
        conversationResolution: false,
        reviews: NO_REVIEWS,
      },
    });
  });

  it('names a required check’s app from a check that reported it', async () => {
    answerWith({
      PullRequestChecks: [answer({ nodes: [run('build')] })],
      rules: [requiredRule(['build', ACTIONS.databaseId])],
    });
    const res = await read();
    expect(items(res)).toHaveLength(1);
    expect(res.rules).toMatchObject({
      value: {
        requiredChecks: [
          { name: 'build', app: { id: '15368', slug: 'github-actions' } },
        ],
      },
    });
  });

  it('keeps the checks when the rules cannot be read, and expects none', async () => {
    answerWith({
      PullRequestChecks: [answer({ nodes: [run('build')] })],
      rules: { stderr: 'HTTP 502: Bad Gateway (https://api.github.com/)' },
    });
    const res = await read();
    expect(res.rules.state).toBe('failed');
    expect(items(res).map((c) => c.outcome)).toEqual(['succeeded']);
    expect(res.merge.native).toBe('BLOCKED');
  });
});

describe('fetchPullRequestChecksGitHub: pages', () => {
  it('reads every page of checks for the same head', async () => {
    answerWith({
      PullRequestChecks: [answer({ nodes: [run('build')], next: 'c1' })],
      PullRequestCheckContexts: [answer({ nodes: [run('lint')] })],
      rules: [requiredRule(['e2e', null])],
    });
    const res = await read();
    expect(res.checks).toMatchObject({
      state: 'read',
      value: { complete: true, total: 3 },
    });
    expect(items(res).map((c) => c.name)).toEqual(['build', 'lint', 'e2e']);
    const page = calls().find((a) =>
      a.some((x) => x.includes('query PullRequestCheckContexts'))
    );
    expect(page).toContain('contextsCursor=c1');
  });

  it('refuses the rest of a list read after the head moved', async () => {
    answerWith({
      PullRequestChecks: [answer({ nodes: [run('build')], next: 'c1' })],
      PullRequestCheckContexts: [
        answer({ nodes: [run('lint')], oid: '2'.repeat(40) }),
      ],
    });
    const res = await read();
    expect(res.checks).toMatchObject({
      state: 'failed',
      kind: 'unexpected-response',
      reason: 'acme/app#42 moved while its checks were read',
    });
    // The rest of the answer is still the first page's.
    expect(res.merge.native).toBe('BLOCKED');
    expect(res.rules.state).toBe('read');
  });

  it('stops at the page cap, and then expects nothing', async () => {
    const pages = Array.from({ length: 9 }, (_, i) =>
      answer({ nodes: [run(`job-${i + 1}`)], next: `c${i + 2}` })
    );
    answerWith({
      PullRequestChecks: [
        answer({ nodes: [run('job-0')], next: 'c1', total: 1200 }),
      ],
      PullRequestCheckContexts: pages,
      rules: [requiredRule(['e2e', null])],
    });
    const res = await read();
    // Not all read, but GitHub says how many there are.
    expect(res.checks).toMatchObject({
      state: 'read',
      value: { complete: false, total: 1200 },
    });
    expect(items(res)).toHaveLength(10);
    expect(items(res).some((c) => c.outcome === 'expected')).toBe(false);
  });
});

describe('fetchPullRequestChecksGitHub: rules', () => {
  it('reads classic protection’s checks, and its conversation rule as enforced on this account', async () => {
    const protection = branch({
      enabled: true,
      required_status_checks: {
        enforcement_level: 'non_admins',
        contexts: ['build', 'lint'],
        checks: [
          { context: 'build', app_id: null },
          { context: 'lint', app_id: ACTIONS.databaseId },
        ],
      },
    });
    const resolving = {
      baseRef: { refUpdateRule: { requiresConversationResolution: true } },
    };
    answerWith({
      PullRequestChecks: [
        answer({ nodes: [run('lint', { app: CIRCLE })] }, resolving),
      ],
      branch: protection,
    });
    const res = await read();
    expect(res.rules).toEqual({
      state: 'read',
      value: {
        requiredChecks: [
          { name: 'build', app: null },
          { name: 'lint', app: { id: '15368', slug: null } },
        ],
        conversationResolution: true,
        reviews: NO_REVIEWS,
      },
    });
    // `lint` must come from GitHub Actions: CircleCI's does not count.
    expect(
      items(res)
        .filter((c) => c.outcome === 'expected')
        .map((c) => c.name)
    ).toEqual(['build', 'lint']);

    // No rule enforced on this account: none about conversations.
    answerWith({
      PullRequestChecks: [answer({ nodes: [] })],
      branch: protection,
    });
    expect((await read()).rules).toMatchObject({
      value: { conversationResolution: false },
    });
  });

  it('lists a check required by two rules once', async () => {
    answerWith({
      PullRequestChecks: [answer({ nodes: [] })],
      branch: branch({
        enabled: true,
        required_status_checks: {
          enforcement_level: 'everyone',
          checks: [{ context: 'build', app_id: null }],
        },
      }),
      rules: [requiredRule(['build', null], ['build', ACTIONS.databaseId])],
    });
    const res = await read();
    expect(items(res).map((c) => c.key)).toEqual([
      'expected:-:build',
      `expected:${ACTIONS.databaseId}:build`,
    ]);
  });

  it('takes a rule set’s conversation rule over classic protection’s silence', async () => {
    answerWith({
      PullRequestChecks: [answer({ nodes: [] })],
      branch: branch({
        enabled: true,
        required_status_checks: {
          enforcement_level: 'off',
          checks: [{ context: 'build', app_id: null }],
        },
      }),
      rules: [RESOLUTION_RULE],
    });
    expect((await read()).rules).toEqual({
      state: 'read',
      // Checks under enforcement `off` are not required.
      value: {
        requiredChecks: [],
        conversationResolution: true,
        reviews: NO_REVIEWS,
      },
    });
  });

  it('reads the review rule from classic protection and every rule set, the strictest of each', async () => {
    answerWith({
      PullRequestChecks: [
        answer(
          { nodes: [] },
          {
            baseRef: {
              refUpdateRule: {
                requiresConversationResolution: false,
                requiredApprovingReviewCount: 1,
                requiresCodeOwnerReviews: false,
              },
            },
          }
        ),
      ],
      rules: [
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 2,
            require_code_owner_review: true,
            required_reviewers: [
              {
                file_patterns: ['src/**'],
                minimum_approvals: 1,
                reviewer: { id: 777, type: 'Team' },
              },
              // Added without requiring its approval.
              {
                file_patterns: [],
                minimum_approvals: 0,
                reviewer: { id: 778, type: 'Team' },
              },
            ],
          },
        },
        {
          type: 'pull_request',
          parameters: { required_approving_review_count: 1 },
        },
      ],
    });
    expect((await read()).rules).toMatchObject({
      state: 'read',
      value: {
        reviews: {
          approvals: 2,
          codeOwners: true,
          named: [
            {
              name: null,
              ids: ['777'],
              kind: 'team',
              approvals: 1,
              paths: ['src/**'],
              applies: null,
              blocking: true,
            },
            {
              name: null,
              ids: ['778'],
              kind: 'team',
              approvals: 0,
              paths: [],
              applies: null,
              blocking: false,
            },
          ],
          approvalsMet: null,
        },
      },
    });

    // Classic protection alone: its count and its code-owner rule.
    answerWith({
      PullRequestChecks: [
        answer(
          { nodes: [] },
          {
            baseRef: {
              refUpdateRule: {
                requiresConversationResolution: false,
                requiredApprovingReviewCount: 3,
                requiresCodeOwnerReviews: true,
              },
            },
          }
        ),
      ],
    });
    expect((await read()).rules).toMatchObject({
      value: { reviews: { approvals: 3, codeOwners: true, named: [] } },
    });
  });

  it('asks for the base branch by its encoded name', async () => {
    answerWith({
      PullRequestChecks: [
        answer({ nodes: [] }, { baseRefName: 'release/2.0#rc' }),
      ],
    });
    await read();
    const rest = calls()
      .filter((a) => a[1] !== 'graphql')
      .map((a) => a[1]);
    expect(rest.sort()).toEqual([
      'repos/acme/app/branches/release%2F2.0%23rc',
      'repos/acme/app/rules/branches/release%2F2.0%23rc?per_page=100',
    ]);
  });

  it('does not take a full page of rule sets for all of them', async () => {
    answerWith({
      PullRequestChecks: [answer({ nodes: [] })],
      rules: Array.from({ length: 100 }, () => RESOLUTION_RULE),
    });
    expect((await read()).rules).toMatchObject({
      state: 'failed',
      kind: 'unexpected-response',
    });
  });
});

describe('fetchPullRequestChecksGitHub: merge state', () => {
  it.each([
    ['CLEAN', false, false],
    ['UNSTABLE', false, false],
    ['HAS_HOOKS', false, false],
    ['BEHIND', true, true],
    ['BLOCKED', null, true],
    ['DIRTY', null, true],
    ['DRAFT', null, null],
    ['UNKNOWN', null, null],
    [null, null, null],
  ])(
    'reads %s as behind %s and blocked %s',
    async (native, behind, blocked) => {
      answerWith({
        PullRequestChecks: [
          answer({ nodes: [] }, { mergeStateStatus: native }),
        ],
      });
      expect((await read()).merge).toMatchObject({ behind, blocked, native });
    }
  );

  it('reads conflicts, draft and the review requirement', async () => {
    answerWith({
      PullRequestChecks: [
        answer(
          { nodes: [] },
          {
            mergeable: 'CONFLICTING',
            isDraft: true,
            reviewDecision: 'CHANGES_REQUESTED',
          }
        ),
        answer({ nodes: [] }, { mergeable: 'UNKNOWN', reviewDecision: null }),
        // GitHub no longer sends `DRAFT`: a draft reads as clean.
        answer(
          { nodes: [] },
          { isDraft: true, mergeStateStatus: 'CLEAN', reviewDecision: null }
        ),
      ],
    });
    expect((await read()).merge).toMatchObject({
      lifecycle: { state: 'open', isDraft: true, native: 'OPEN' },
      conflicts: 'conflicting',
      reviews: 'changes-requested',
      // GitHub states the rule, never a verdict on the threads.
      conversations: null,
    });
    // GitHub leaves the decision out whether or not review is required.
    expect((await read()).merge).toMatchObject({
      conflicts: 'unknown',
      reviews: 'unknown',
    });
    // Nothing else blocks it by GitHub's word; the draft is the
    // lifecycle's to say.
    expect((await read()).merge).toMatchObject({
      lifecycle: { isDraft: true },
      blocked: false,
      native: 'CLEAN',
    });
  });

  it('refuses a pull request GitHub cannot find, or a state it does not know', async () => {
    answerWith({
      PullRequestChecks: [
        { data: { repository: { pullRequest: null } } },
        answer({ nodes: [] }, { state: 'LOCKED' }),
      ],
    });
    await expect(read()).rejects.toMatchObject({ kind: 'not-found' });
    await expect(read()).rejects.toMatchObject({ kind: 'unexpected-response' });
  });
});
