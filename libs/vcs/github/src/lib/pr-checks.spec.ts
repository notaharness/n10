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

function run(
  name: string,
  over: Partial<{
    status: string;
    conclusion: string | null;
    isRequired: boolean | null;
    app: { slug: string; databaseId: number };
    workflow: string;
    event: string;
    /** A third-party app's suite, which has no workflow run. */
    external: boolean;
  }> = {}
): Json {
  return {
    __typename: 'CheckRun',
    name,
    status: over.status ?? 'COMPLETED',
    conclusion: over.conclusion === undefined ? 'SUCCESS' : over.conclusion,
    startedAt: '2026-09-26T10:00:00Z',
    completedAt: '2026-09-26T10:04:00Z',
    detailsUrl: `https://github.com/acme/app/actions/runs/1/job/${name}`,
    isRequired: over.isRequired === undefined ? true : over.isRequired,
    checkSuite: {
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
}

/** One answer of the checks query, or of its contexts page. */
function answer(page: PageOf, pr: Json = {}): Json {
  return {
    data: {
      repository: {
        pullRequest: {
          number: 42,
          state: 'OPEN',
          isDraft: false,
          baseRefName: 'main',
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'BLOCKED',
          reviewDecision: 'REVIEW_REQUIRED',
          ...pr,
          commits: {
            nodes: [
              {
                commit: {
                  oid: page.oid ?? HEAD,
                  statusCheckRollup: {
                    contexts: {
                      totalCount: page.nodes.length,
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
    expect(res.ref).toEqual({
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
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
      group: 'CI',
      source: 'github-actions',
      revision: HEAD,
      // A `pull_request` run tests the head merged into the base.
      ranOn: 'merge',
      attempt: 2,
      url: 'https://github.com/acme/app/actions/runs/1/job/build',
    });
    expect(items(res)[4]).toMatchObject({
      group: null,
      source: 'preview-bot',
      ranOn: null,
      completedAt: '2026-09-26T10:02:00Z',
    });
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

  it('says what a run tested only where its event says', async () => {
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
    // A `pull_request_target` run checks out the base's workflow, and a
    // third-party app's suite names no event: nothing says what either
    // tested.
    expect(items(await read()).map((c) => c.ranOn)).toEqual([
      'revision',
      null,
      null,
    ]);
  });

  it('tells two apps’, or two workflows’, checks of one name apart', async () => {
    answerWith({
      PullRequestChecks: [
        answer({
          nodes: [
            run('build'),
            run('build', { app: CIRCLE }),
            run('build', { workflow: 'Nightly' }),
          ],
        }),
      ],
    });
    const keys = items(await read()).map((c) => c.key);
    expect(new Set(keys).size).toBe(3);
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
    expect(res.rules).toEqual({
      state: 'read',
      value: {
        requiredChecks: [
          // The app is named where a check on the head shows which.
          { name: 'build', source: null },
          { name: 'e2e', source: null },
        ],
        conversationResolution: false,
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
      value: { requiredChecks: [{ name: 'build', source: 'github-actions' }] },
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
      PullRequestChecks: [answer({ nodes: [run('job-0')], next: 'c1' })],
      PullRequestCheckContexts: pages,
      rules: [requiredRule(['e2e', null])],
    });
    const res = await read();
    expect(res.checks).toMatchObject({
      state: 'read',
      value: { complete: false, total: null },
    });
    expect(items(res)).toHaveLength(10);
    expect(items(res).some((c) => c.outcome === 'expected')).toBe(false);
  });
});

describe('fetchPullRequestChecksGitHub: rules', () => {
  it('reads classic protection’s checks, and does not know about conversations under it', async () => {
    answerWith({
      PullRequestChecks: [answer({ nodes: [] })],
      branch: branch({
        enabled: true,
        required_status_checks: {
          enforcement_level: 'non_admins',
          contexts: ['build'],
          checks: [{ context: 'build', app_id: null }],
        },
      }),
    });
    const res = await read();
    expect(res.rules).toEqual({
      state: 'read',
      value: {
        requiredChecks: [{ name: 'build', source: null }],
        conversationResolution: null,
      },
    });
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
      value: { requiredChecks: [], conversationResolution: true },
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
    ['DRAFT', null, true],
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
      ],
    });
    expect((await read()).merge).toMatchObject({
      lifecycle: { state: 'open', isDraft: true, native: 'OPEN' },
      conflicts: 'conflicting',
      reviews: 'changes-requested',
    });
    // No decision where no review is required.
    expect((await read()).merge).toMatchObject({
      conflicts: 'unknown',
      reviews: 'not-required',
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
