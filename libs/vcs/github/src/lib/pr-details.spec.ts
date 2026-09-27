import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isVcsError,
  type DetailReviewer,
  type ListRead,
  type PullRequestDetail,
} from '@n10/vcs-core';
import { fetchPullRequestDetailGitHub } from './pr-details.js';
import { githubProvider } from './provider.js';

/**
 * The GitHub detail read against recorded-shape answers: the pull
 * request's identity and its fork, every page of its reviewers, and
 * the ways a read can be refused.
 */

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execSync: vi.fn(),
}));

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8')
  ) as Json;
}

const CONNECTIONS = [
  'latestOpinionatedReviews',
  'latestReviews',
  'reviewRequests',
] as const;

/** The first page with every connection ending there. */
function onePage(edit: (pr: Json) => void = () => undefined): Json {
  const answer = fixture('pr-detail');
  const pr = (answer.data as Json).repository as Json;
  const node = pr.pullRequest as Json;
  for (const key of CONNECTIONS) {
    const conn = node[key] as Json;
    conn.pageInfo = { hasNextPage: false, endCursor: null };
  }
  edit(node);
  return answer;
}

/** What `gh` prints when it fails, in place of an answer. */
interface Failure {
  stderr: string;
}

/** Answer each `gh` call with the next of `answers`, by query name. */
function answerWith(answers: Record<string, (Json | Failure)[]>) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      args: string[],
      cb: (err: unknown, res?: { stdout: string }) => void
    ) => {
      const query = args.find((a) => a.startsWith('query=')) ?? '';
      const name = /query (\w+)/.exec(query)?.[1] ?? '';
      const next = answers[name]?.shift();
      if (!next) cb({ stderr: `unexpected query ${name}` });
      else if ('stderr' in next) cb(next);
      else cb(null, { stdout: JSON.stringify(next) });
    }
  );
}

function calls(): { name: string; vars: Record<string, string> }[] {
  return (mockExecFile.mock.calls as [string, string[]][]).map(([, args]) => {
    const vars: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-f' || args[i] === '-F') {
        const [k, ...v] = args[i + 1].split('=');
        vars[k] = v.join('=');
      }
    }
    return { name: /query (\w+)/.exec(vars.query)?.[1] ?? '', vars };
  });
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('fetchPullRequestDetailGitHub: identity', () => {
  it("names the pull request by its repository's id and its commits", async () => {
    answerWith({ PullRequestDetail: [onePage()] });
    const detail = await fetchPullRequestDetailGitHub('acme', 'app', 214);

    expect(detail.ref).toEqual({
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
      id: '11223344',
      number: 214,
    });
    expect(detail.author).toEqual({
      identifier: 'alex',
      displayName: 'Alex Doe',
    });
    expect(detail.lifecycle).toEqual({
      state: 'open',
      isDraft: false,
      native: 'OPEN',
    });
    expect(detail.source).toEqual({
      branch: 'cancel-requests',
      repository: {
        provider: 'github',
        host: 'github.com',
        repository: 'acme/app',
        id: '11223344',
      },
      head: '1'.repeat(40),
    });
    expect(detail.target).toEqual({ branch: 'main', head: '2'.repeat(40) });
    expect(detail.updatedAt).toBe('2026-09-26T14:02:11Z');
    expect(calls()[0].vars).toMatchObject({
      owner: 'acme',
      repo: 'app',
      number: '214',
    });
  });

  it('names a fork as its own repository, and a deleted one as gone', async () => {
    answerWith({
      PullRequestDetail: [
        onePage((pr) => {
          pr.headRepository = {
            databaseId: 55667788,
            nameWithOwner: 'alex/app',
          };
        }),
        onePage((pr) => {
          pr.headRepository = null;
        }),
      ],
    });
    const fork = await fetchPullRequestDetailGitHub('acme', 'app', 214);
    expect(fork.source.repository).toEqual({
      provider: 'github',
      host: 'github.com',
      repository: 'alex/app',
      id: '55667788',
    });
    // The fork's id, not the base repository's: the same branch name in
    // two repositories is two branches.
    expect(fork.ref.id).toBe('11223344');

    const deleted = await fetchPullRequestDetailGitHub('acme', 'app', 214);
    expect(deleted.source.repository).toBeNull();
    expect(deleted.source.head).toBe('1'.repeat(40));
  });

  it.each([
    ['MERGED', false, { state: 'merged', isDraft: false, native: 'MERGED' }],
    ['CLOSED', false, { state: 'closed', isDraft: false, native: 'CLOSED' }],
    ['OPEN', true, { state: 'open', isDraft: true, native: 'OPEN' }],
  ])(
    'reads %s (draft: %s) in GitHub’s own words',
    async (state, isDraft, want) => {
      answerWith({
        PullRequestDetail: [
          onePage((pr) => {
            pr.state = state;
            pr.isDraft = isDraft;
          }),
        ],
      });
      const detail = await fetchPullRequestDetailGitHub('acme', 'app', 214);
      expect(detail.lifecycle).toEqual(want);
    }
  );

  it('says whether this account may edit the pull request', async () => {
    answerWith({
      PullRequestDetail: [
        onePage(),
        onePage((pr) => {
          pr.viewerCanUpdate = false;
        }),
      ],
    });
    const mine = await fetchPullRequestDetailGitHub('acme', 'app', 214);
    expect(mine.capabilities.update).toEqual({ state: 'supported' });
    const theirs = await fetchPullRequestDetailGitHub('acme', 'app', 214);
    expect(theirs.capabilities.update).toEqual({
      state: 'forbidden',
      reason: 'Your GitHub account cannot edit this pull request',
    });
  });

  it('shows a deleted author as GitHub does', async () => {
    answerWith({
      PullRequestDetail: [
        onePage((pr) => {
          pr.author = null;
        }),
      ],
    });
    const detail = await fetchPullRequestDetailGitHub('acme', 'app', 214);
    expect(detail.author).toEqual({
      identifier: 'ghost',
      displayName: 'ghost',
    });
  });
});

/** The reviewers, which a well-formed answer always reads. */
function readReviewers(detail: PullRequestDetail): ListRead<DetailReviewer> {
  if (detail.reviewers.state !== 'read') {
    throw new Error(`reviewers were not read: ${detail.reviewers.reason}`);
  }
  return detail.reviewers.value;
}

/** A reviewer as the read names them, with nothing yet known. */
function reviewer(fields: Partial<DetailReviewer>): DetailReviewer {
  return {
    kind: 'user',
    identifier: '',
    id: null,
    displayName: '',
    decision: 'no-response',
    native: null,
    requested: false,
    attention: false,
    required: null,
    reason: null,
    onBehalfOf: [],
    reviewedHead: null,
    ...fields,
  };
}

/** The connection `key` of a pull request answer. */
function connectionOf(answer: Json, key: string): Json {
  const repo = (answer.data as Json).repository as Json;
  return (repo.pullRequest as Json)[key] as Json;
}

const PAGE_QUERY: Record<(typeof CONNECTIONS)[number], string> = {
  latestOpinionatedReviews: 'PullRequestOpinionsPage',
  latestReviews: 'PullRequestReviewsPage',
  reviewRequests: 'PullRequestRequestsPage',
};

const CURSOR: Record<(typeof CONNECTIONS)[number], string> = {
  latestOpinionatedReviews: 'opinionsCursor',
  latestReviews: 'reviewsCursor',
  reviewRequests: 'requestsCursor',
};

describe('fetchPullRequestDetailGitHub: reviewers', () => {
  it('reads every page of verdicts, reviews and requests, people and teams', async () => {
    answerWith({
      PullRequestDetail: [fixture('pr-detail')],
      PullRequestOpinionsPage: [fixture('pr-detail-opinions-page-2')],
      PullRequestReviewsPage: [fixture('pr-detail-reviews-page-2')],
      PullRequestRequestsPage: [fixture('pr-detail-requests-page-2')],
    });
    const reviewers = readReviewers(
      await fetchPullRequestDetailGitHub('acme', 'app', 214)
    );

    expect(reviewers).toMatchObject({ total: 7, complete: true });
    expect(reviewers.items).toEqual([
      // Approved an older commit and was asked again: the approval
      // stands, and so does which commit it judged. GitHub leaves
      // someone with an open request out of latestReviews.
      reviewer({
        identifier: 'Bea',
        id: 'U_bea',
        displayName: 'Bea',
        decision: 'approved',
        native: 'APPROVED',
        requested: true,
        reviewedHead: '0'.repeat(39) + '1',
      }),
      reviewer({
        identifier: 'cy',
        id: 'U_cy',
        displayName: 'cy',
        decision: 'changes-requested',
        native: 'CHANGES_REQUESTED',
        onBehalfOf: ['acme/web'],
        reviewedHead: '1'.repeat(40),
      }),
      // Approved, then replied in a thread, which GitHub files as a
      // COMMENTED review: the approval is what stands.
      reviewer({
        identifier: 'fay',
        id: 'U_fay',
        displayName: 'Fay',
        decision: 'approved',
        native: 'APPROVED',
        reviewedHead: '1'.repeat(40),
      }),
      // Only commented: listed, with no verdict and no judged commit.
      reviewer({
        identifier: 'dee',
        id: 'U_dee',
        displayName: 'Dee',
        native: 'COMMENTED',
      }),
      reviewer({
        kind: 'team',
        identifier: 'acme/core',
        id: 'T_core',
        displayName: 'Core team',
        requested: true,
        reason: 'code-owner',
      }),
      reviewer({
        identifier: 'eve',
        id: 'U_eve',
        displayName: 'eve',
        requested: true,
      }),
      reviewer({
        kind: 'team',
        identifier: 'acme-enterprise/platform',
        id: 'ET_plat',
        displayName: 'Platform',
        requested: true,
      }),
    ]);

    // Each further page is asked for after the cursor it continues from.
    expect(
      calls()
        .filter((c) => c.name !== 'PullRequestDetail')
        .map((c) => [
          c.name,
          c.vars.opinionsCursor ??
            c.vars.reviewsCursor ??
            c.vars.requestsCursor,
        ])
        .sort()
    ).toEqual([
      ['PullRequestOpinionsPage', 'op-1'],
      ['PullRequestRequestsPage', 'req-1'],
      ['PullRequestReviewsPage', 'rev-1'],
    ]);
  });

  it('counts reviewers GitHub will not name, and says the list is incomplete', async () => {
    answerWith({
      PullRequestDetail: [
        onePage((pr) => {
          const requests = pr.reviewRequests as Json;
          // A code-owner team in an organization this account is not in,
          // and a reviewer type the read does not know.
          requests.nodes = [
            ...(requests.nodes as Json[]),
            { asCodeOwner: true, requestedReviewer: null },
            { asCodeOwner: false, requestedReviewer: {} },
          ];
          const reviews = pr.latestReviews as Json;
          reviews.nodes = [
            ...(reviews.nodes as Json[]),
            { author: null, state: 'COMMENTED' },
          ];
        }),
      ],
    });
    const reviewers = readReviewers(
      await fetchPullRequestDetailGitHub('acme', 'app', 214)
    );
    expect(reviewers.items.map((r) => r.identifier)).toEqual([
      'Bea',
      'cy',
      'acme/core',
    ]);
    expect(reviewers).toMatchObject({ complete: false, total: 6 });
  });

  it('keeps a bot a bot, whether it reviewed or was asked', async () => {
    answerWith({
      PullRequestDetail: [
        onePage((pr) => {
          const reviews = pr.latestReviews as Json;
          reviews.nodes = [
            ...(reviews.nodes as Json[]),
            {
              author: {
                __typename: 'Bot',
                login: 'copilot-pull-request-reviewer',
                id: 'BOT_kgDOCnlnWA',
              },
              state: 'COMMENTED',
            },
          ];
          const requests = pr.reviewRequests as Json;
          requests.nodes = [
            ...(requests.nodes as Json[]),
            {
              asCodeOwner: false,
              requestedReviewer: {
                __typename: 'Bot',
                id: 'BOT_renovate',
                login: 'renovate',
              },
            },
            {
              asCodeOwner: false,
              requestedReviewer: {
                __typename: 'Mannequin',
                id: 'MQ_old',
                login: 'old-account',
              },
            },
          ];
        }),
      ],
    });
    const reviewers = readReviewers(
      await fetchPullRequestDetailGitHub('acme', 'app', 214)
    );
    expect(
      Object.fromEntries(reviewers.items.map((r) => [r.identifier, r.kind]))
    ).toMatchObject({
      Bea: 'user',
      'copilot-pull-request-reviewer': 'bot',
      renovate: 'bot',
      // An imported account's placeholder stands for a person.
      'old-account': 'user',
      'acme/core': 'team',
    });
  });

  it.each(CONNECTIONS)(
    'follows each cursor of %s, stops after ten pages and claims no count',
    async (key) => {
      const endless = (n: number): Json => {
        const answer = fixture(
          {
            latestOpinionatedReviews: 'pr-detail-opinions-page-2',
            latestReviews: 'pr-detail-reviews-page-2',
            reviewRequests: 'pr-detail-requests-page-2',
          }[key]
        );
        connectionOf(answer, key).pageInfo = {
          hasNextPage: true,
          endCursor: `${key}-${n + 2}`,
        };
        return answer;
      };
      answerWith({
        PullRequestDetail: [
          onePage((pr) => {
            (pr[key] as Json).pageInfo = {
              hasNextPage: true,
              endCursor: `${key}-1`,
            };
          }),
        ],
        [PAGE_QUERY[key]]: Array.from({ length: 20 }, (_, n) => endless(n)),
      });
      const reviewers = readReviewers(
        await fetchPullRequestDetailGitHub('acme', 'app', 214)
      );
      expect(reviewers.complete).toBe(false);
      // Someone can be in several connections, so no count is claimed.
      expect(reviewers.total).toBeNull();
      expect(
        calls()
          .filter((c) => c.name === PAGE_QUERY[key])
          .map((c) => c.vars[CURSOR[key]])
      ).toEqual(Array.from({ length: 9 }, (_, n) => `${key}-${n + 1}`));
    }
  );

  it('keeps the rest of the detail when a reviewer page fails', async () => {
    answerWith({
      PullRequestDetail: [
        onePage((pr) => {
          (pr.latestReviews as Json).pageInfo = {
            hasNextPage: true,
            endCursor: 'rev-1',
          };
        }),
      ],
      PullRequestReviewsPage: [
        { stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)' },
      ],
    });
    const detail = await fetchPullRequestDetailGitHub('acme', 'app', 214);
    expect(detail.reviewers).toMatchObject({
      state: 'failed',
      kind: 'throttled',
    });
    expect(detail.lifecycle.state).toBe('open');
    expect(detail.source.head).toBe('1'.repeat(40));
  });
});

describe('fetchPullRequestDetailGitHub: refusals', () => {
  it('reports a pull request it cannot see as not found', async () => {
    answerWith({
      PullRequestDetail: [
        onePage(),
        {
          data: {
            repository: {
              databaseId: 1,
              nameWithOwner: 'acme/app',
              pullRequest: null,
            },
          },
        },
      ],
    });
    await fetchPullRequestDetailGitHub('acme', 'app', 214);
    const err: unknown = await fetchPullRequestDetailGitHub(
      'acme',
      'app',
      999
    ).catch((e: unknown) => e);
    expect(isVcsError(err) && err.kind).toBe('not-found');
  });

  it("classifies gh's own not-found", async () => {
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], cb: (err: unknown) => void) =>
        cb({
          stderr:
            "GraphQL: Could not resolve to a Repository with the name 'acme/gone'.",
        })
    );
    const err: unknown = await fetchPullRequestDetailGitHub(
      'acme',
      'gone',
      1
    ).catch((e: unknown) => e);
    expect(isVcsError(err) && err.kind).toBe('not-found');
  });

  it('refuses a head that is not a full commit id, or a state it does not know', async () => {
    answerWith({
      PullRequestDetail: [
        onePage((pr) => {
          pr.headRefOid = 'abc123';
        }),
        onePage((pr) => {
          pr.state = 'LOCKED';
        }),
      ],
    });
    for (let i = 0; i < 2; i++) {
      const err: unknown = await fetchPullRequestDetailGitHub(
        'acme',
        'app',
        214
      ).catch((e: unknown) => e);
      expect(isVcsError(err) && err.kind).toBe('unexpected-response');
    }
  });
});

describe('githubProvider.fetchPullRequestDetail', () => {
  it("reads the configured repository's pull request", async () => {
    answerWith({ PullRequestDetail: [onePage()] });
    const detail = await githubProvider.fetchPullRequestDetail?.(
      {},
      { owner: 'acme', repo: 'app' },
      214
    );
    expect(detail?.ref.number).toBe(214);
    expect(calls()).toHaveLength(1);
  });

  it('refuses without a configured repository, without calling gh', async () => {
    await expect(
      githubProvider.fetchPullRequestDetail?.({}, { owner: 'acme' }, 214)
    ).rejects.toThrow('No GitHub repository is configured');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
