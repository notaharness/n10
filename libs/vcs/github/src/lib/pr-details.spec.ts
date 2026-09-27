import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isVcsError } from '@n10/vcs-core';
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

/** The first page with both connections ending there. */
function onePage(edit: (pr: Json) => void = () => undefined): Json {
  const answer = fixture('pr-detail');
  const pr = (answer.data as Json).repository as Json;
  const node = pr.pullRequest as Json;
  for (const key of ['latestReviews', 'reviewRequests']) {
    const conn = node[key] as Json;
    conn.pageInfo = { hasNextPage: false, endCursor: null };
  }
  edit(node);
  return answer;
}

/** Answer each `gh` call with the next of `answers`, by query name. */
function answerWith(answers: Record<string, Json[]>) {
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
      id: 'R_kgDOAcme01',
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
        id: 'R_kgDOAcme01',
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
          pr.headRepository = { id: 'R_fork', nameWithOwner: 'alex/app' };
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
      id: 'R_fork',
    });
    // The fork's id, not the base repository's: the same branch name in
    // two repositories is two branches.
    expect(fork.ref.id).toBe('R_kgDOAcme01');

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

describe('fetchPullRequestDetailGitHub: reviewers', () => {
  it('reads every page of reviews and requests, people and teams', async () => {
    answerWith({
      PullRequestDetail: [fixture('pr-detail')],
      PullRequestReviewsPage: [fixture('pr-detail-reviews-page-2')],
      PullRequestRequestsPage: [fixture('pr-detail-requests-page-2')],
    });
    const { reviewers } = await fetchPullRequestDetailGitHub(
      'acme',
      'app',
      214
    );

    expect(reviewers).toMatchObject({ total: 5, complete: true });
    expect(reviewers.items).toEqual([
      // Approved an older commit, and asked again since: the verdict and
      // the request are both kept, and so is which commit it judged.
      {
        kind: 'user',
        identifier: 'Bea',
        displayName: 'Bea',
        decision: 'approved',
        native: 'APPROVED',
        requested: true,
        required: null,
        reviewedHead: '0'.repeat(39) + '1',
      },
      {
        kind: 'user',
        identifier: 'cy',
        displayName: 'cy',
        decision: 'changes-requested',
        native: 'CHANGES_REQUESTED',
        requested: false,
        required: null,
        reviewedHead: '1'.repeat(40),
      },
      // A comment is not a verdict, and names no reviewed commit.
      {
        kind: 'user',
        identifier: 'dee',
        displayName: 'Dee',
        decision: 'no-response',
        native: 'COMMENTED',
        requested: false,
        required: null,
        reviewedHead: null,
      },
      {
        kind: 'team',
        identifier: 'acme/core',
        displayName: 'Core team',
        decision: 'no-response',
        native: null,
        requested: true,
        required: null,
        reviewedHead: null,
      },
      {
        kind: 'user',
        identifier: 'eve',
        displayName: 'eve',
        decision: 'no-response',
        native: null,
        requested: true,
        required: null,
        reviewedHead: null,
      },
    ]);

    // Each further page is asked for after the cursor it continues from.
    expect(
      calls()
        .filter((c) => c.name !== 'PullRequestDetail')
        .map((c) => [c.name, c.vars.reviewsCursor ?? c.vars.requestsCursor])
        .sort()
    ).toEqual([
      ['PullRequestRequestsPage', 'req-1'],
      ['PullRequestReviewsPage', 'rev-1'],
    ]);
  });

  it('stops after ten pages and says the list is incomplete', async () => {
    const endless = (): Json => {
      const page = fixture('pr-detail-reviews-page-2');
      const conn = (
        ((page.data as Json).repository as Json).pullRequest as Json
      ).latestReviews as Json;
      conn.pageInfo = { hasNextPage: true, endCursor: 'more' };
      return page;
    };
    answerWith({
      PullRequestDetail: [
        onePage((pr) => {
          (pr.latestReviews as Json).pageInfo = {
            hasNextPage: true,
            endCursor: 'rev-1',
          };
        }),
      ],
      PullRequestReviewsPage: Array.from({ length: 20 }, endless),
    });
    const { reviewers } = await fetchPullRequestDetailGitHub(
      'acme',
      'app',
      214
    );
    expect(reviewers.complete).toBe(false);
    // Someone can be on both lists, so no count is claimed.
    expect(reviewers.total).toBeNull();
    expect(
      calls().filter((c) => c.name === 'PullRequestReviewsPage')
    ).toHaveLength(9);
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
              id: 'R',
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
