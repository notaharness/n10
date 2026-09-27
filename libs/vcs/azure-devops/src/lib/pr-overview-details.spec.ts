import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isVcsError,
  samePullRequest,
  type DetailReviewer,
  type ListRead,
  type PullRequestDetail,
} from '@n10/vcs-core';
import { azureDevOpsProvider } from './provider.js';
import { resetAdoTransport } from './request.js';

/**
 * The Azure DevOps detail read against the documented response shape:
 * the pull request's identity and fork, every vote as Azure cast it,
 * the iteration at its head, and the reads that can fail on their own.
 */

const AUTH = { pat: 'test-pat' };
const PROJECT = { org: 'contoso', project: 'Fabrikam', repo: 'fabrikam-app' };
const REPO_ID = '5b0c8e8a-1f3e-4c4e-9d3a-2f6b7c8d9e01';
const HEAD = '3'.repeat(40);

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8')
  ) as Json;
}

function json(data: unknown, status = 200): Response {
  const body = JSON.stringify(data);
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** Answer the pull request and its iterations; `null` for a 404, a
 *  number for that failing status. */
function serve(
  pr: Json | number | null = fixture('pr-detail'),
  iterations: Json | number = fixture('pr-detail-iterations')
) {
  const answer = (value: Json | number | null) =>
    Promise.resolve(
      value === null
        ? json({ message: 'TF401180: not found' }, 404)
        : typeof value === 'number'
        ? json({ message: 'failed' }, value)
        : json(value)
    );
  mockFetch.mockImplementation((url: string) => {
    if (/\/pullrequests\/\d+\/iterations\?/.test(url)) {
      return answer(iterations);
    }
    if (/\/pullrequests\/\d+\?/.test(url)) return answer(pr);
    return Promise.resolve(json({ message: `unexpected ${url}` }, 404));
  });
}

/** The fixture with `edit` applied to it. */
function editedPr(edit: (pr: Json) => void): Json {
  const pr = fixture('pr-detail');
  edit(pr);
  return pr;
}

async function read(prId = 4211): Promise<PullRequestDetail> {
  const detail = await azureDevOpsProvider.fetchPullRequestDetail?.(
    AUTH,
    PROJECT,
    prId
  );
  if (!detail) throw new Error('Azure DevOps reads no detail');
  return detail;
}

function reviewersOf(detail: PullRequestDetail): ListRead<DetailReviewer> {
  if (detail.reviewers.state !== 'read') throw new Error('not read');
  return detail.reviewers.value;
}

function byName(detail: PullRequestDetail, identifier: string) {
  return reviewersOf(detail).items.find((r) => r.identifier === identifier);
}

beforeEach(() => {
  mockFetch.mockReset();
  resetAdoTransport();
});

describe('fetchPullRequestDetail (Azure DevOps): identity', () => {
  it("names the pull request by the configured path and the repository's id", async () => {
    serve();
    const detail = await read();
    expect(detail.ref).toEqual({
      provider: 'azure-devops',
      host: 'dev.azure.com/contoso',
      repository: 'Fabrikam/fabrikam-app',
      id: REPO_ID,
      number: 4211,
    });
    // The host asks with the configured repository's ref, and refuses
    // an answer about any other.
    const asked = azureDevOpsProvider.repositoryRef?.(PROJECT);
    expect(
      asked && samePullRequest({ ...asked, number: 4211 }, detail.ref)
    ).toBe(true);
    expect(detail.lifecycle).toEqual({
      state: 'open',
      isDraft: false,
      native: 'active',
    });
    expect(detail.source).toEqual({
      branch: 'feature/cancel-requests',
      repository: {
        provider: 'azure-devops',
        host: 'dev.azure.com/contoso',
        repository: 'Fabrikam/fabrikam-app',
        id: REPO_ID,
      },
      head: HEAD,
    });
    expect(detail.target).toEqual({ branch: 'main', head: 'b'.repeat(40) });
    expect(detail.author).toEqual({
      identifier: 'alex@contoso.example',
      displayName: 'Alex Doe',
    });
    expect(detail.createdAt).toBe('2026-09-22T09:30:00.000Z');
    // Azure keeps no time of the last change, and n10 invents none.
    expect(detail.updatedAt).toBeNull();
    // Nor does it say whether this account may edit the pull request.
    expect(detail.capabilities.update.state).toBe('unknown');
    expect(detail.url).toBe(
      'https://dev.azure.com/contoso/Fabrikam/_git/fabrikam-app/pullrequest/4211'
    );
  });

  it.each([
    ['abandoned', false, { state: 'closed', isDraft: false }],
    ['completed', false, { state: 'merged', isDraft: false }],
    ['active', true, { state: 'open', isDraft: true }],
  ])(
    'reads %s (draft: %s) in Azure’s own words',
    async (status, isDraft, want) => {
      serve(
        editedPr((pr) => {
          pr.status = status;
          pr.isDraft = isDraft;
        })
      );
      expect((await read()).lifecycle).toEqual({ ...want, native: status });
    }
  );

  it('names a fork as its own repository, and one Azure no longer names as gone', async () => {
    const fork = {
      id: 'f0f0f0f0-0000-4000-8000-000000000001',
      name: 'fabrikam-app',
      project: { name: 'Forks' },
    };
    serve(
      editedPr((pr) => {
        pr.forkSource = { name: 'refs/heads/feature/x', repository: fork };
      })
    );
    const forked = await read();
    expect(forked.source.repository).toEqual({
      provider: 'azure-devops',
      host: 'dev.azure.com/contoso',
      repository: 'Forks/fabrikam-app',
      id: fork.id,
    });
    expect(forked.ref.id).toBe(REPO_ID);

    resetAdoTransport();
    serve(
      editedPr((pr) => {
        pr.forkSource = { name: 'refs/heads/feature/x' };
      })
    );
    expect((await read()).source.repository).toBeNull();
  });

  it('refuses a status it does not know, or a pull request with no source commit', async () => {
    for (const edit of [
      (pr: Json) => {
        pr.status = 'notSet';
      },
      (pr: Json) => {
        delete pr.lastMergeSourceCommit;
      },
    ]) {
      resetAdoTransport();
      serve(editedPr(edit));
      const err: unknown = await read().catch((e: unknown) => e);
      expect(isVcsError(err) && err.kind).toBe('unexpected-response');
    }
  });

  it('reports a pull request Azure cannot find as not found', async () => {
    serve(null);
    const err: unknown = await read(9999).catch((e: unknown) => e);
    expect(isVcsError(err) && err.kind).toBe('not-found');
  });
});

describe('fetchPullRequestDetail (Azure DevOps): reviewers', () => {
  it('keeps every vote as Azure cast it', async () => {
    serve();
    const detail = await read();
    const votes = reviewersOf(detail).items.map((r) => [
      r.identifier,
      r.decision,
      r.native,
    ]);
    expect(votes).toEqual([
      // Approve with suggestions reads as approved and stays a 5.
      ['ana@contoso.example', 'approved', '5'],
      ['ben@contoso.example', 'approved', '10'],
      ['cai@contoso.example', 'waiting-for-author', '-5'],
      ['dana@contoso.example', 'rejected', '-10'],
      ['eli@contoso.example', 'no-response', '0'],
      ['fay@contoso.example', 'declined', '0'],
      ['sam.lee@contoso.example', 'no-response', '0'],
      ['samuel.lee@contoso.example', 'approved', '10'],
      [expect.stringContaining('\\Web Reviewers'), 'approved', '5'],
      [expect.stringContaining('\\Release Approvers'), 'no-response', '0'],
    ]);
    expect(reviewersOf(detail)).toMatchObject({ total: 10, complete: true });
  });

  it('says who is asked, who is required by policy, and which group a vote counted for', async () => {
    serve();
    const detail = await read();
    // Listed without a vote is asked; flagged for attention is still
    // only asked; declining is an answer.
    expect(byName(detail, 'eli@contoso.example')).toMatchObject({
      requested: true,
    });
    expect(byName(detail, 'fay@contoso.example')).toMatchObject({
      requested: false,
    });
    expect(byName(detail, 'ben@contoso.example')).toMatchObject({
      requested: false,
      required: false,
      reason: null,
    });

    const groups = reviewersOf(detail).items.filter((r) => r.kind === 'team');
    expect(groups.map((g) => [g.displayName, g.required, g.reason])).toEqual([
      ['[Fabrikam]\\Web Reviewers', true, 'policy'],
      ['[Fabrikam]\\Release Approvers', true, 'policy'],
    ]);
    expect(byName(detail, 'ana@contoso.example')?.onBehalfOf).toEqual([
      groups[0]?.identifier,
    ]);
  });

  it('tells people with one display name apart, and names no reviewed commit', async () => {
    serve();
    const sams = reviewersOf(await read()).items.filter(
      (r) => r.displayName === 'Sam Lee'
    );
    expect(sams.map((s) => [s.identifier, s.id])).toEqual([
      ['sam.lee@contoso.example', '00000000-0000-4000-8000-000000000007'],
      ['samuel.lee@contoso.example', '00000000-0000-4000-8000-000000000008'],
    ]);
    // Azure does not record which commit a vote was cast on.
    expect(sams.map((s) => s.reviewedHead)).toEqual([null, null]);
  });

  it('counts a reviewer it cannot name and does not call the list whole', async () => {
    serve(
      editedPr((pr) => {
        (pr.reviewers as Json[]).push({ vote: 10 });
      })
    );
    const reviewers = reviewersOf(await read());
    expect(reviewers.items).toHaveLength(10);
    expect(reviewers).toMatchObject({ complete: false, total: 11 });
  });
});

describe('fetchPullRequestDetail (Azure DevOps): iteration', () => {
  it('names the iteration that pushed the head', async () => {
    serve();
    expect((await read()).iteration).toEqual({
      state: 'read',
      value: {
        id: 3,
        source: HEAD,
        target: 'b'.repeat(40),
        base: 'c'.repeat(40),
      },
    });
  });

  it('names none when the head moved between the two reads', async () => {
    serve(
      editedPr((pr) => {
        pr.lastMergeSourceCommit = { commitId: '4'.repeat(40) };
      })
    );
    expect((await read()).iteration).toEqual({ state: 'read', value: null });
  });

  it('keeps the pull request when its iterations cannot be read', async () => {
    serve(fixture('pr-detail'), 500);
    const detail = await read();
    expect(detail.iteration).toMatchObject({ state: 'failed' });
    expect(detail.source.head).toBe(HEAD);
    expect(reviewersOf(detail).total).toBe(10);
  });
});

describe('fetchPullRequestDetail (Azure DevOps): cache', () => {
  it('reads again after this account votes', async () => {
    serve();
    await read();
    await read();
    const reads = () =>
      mockFetch.mock.calls.filter(([url]) =>
        /\/pullrequests\/4211\?/.test(String(url))
      ).length;
    expect(reads()).toBe(1);

    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/_apis/connectiondata')) {
        return Promise.resolve(json({ authenticatedUser: { id: 'me' } }));
      }
      if (init?.method === 'PUT') return Promise.resolve(json({}));
      if (/\/pullrequests\/\d+\/iterations\?/.test(url)) {
        return Promise.resolve(json(fixture('pr-detail-iterations')));
      }
      return Promise.resolve(json(fixture('pr-detail')));
    });
    await azureDevOpsProvider.submitReviewVerdict?.(
      AUTH,
      PROJECT,
      4211,
      'approve'
    );
    await read();
    expect(reads()).toBe(2);
  });
});
