import { describe, expect, it } from 'vitest';
import {
  VcsError,
  type PullRequestDetail,
  type PullRequestInfo,
  type PullRequestRef,
} from '@n10/vcs-core';
import {
  PullRequestIdentityError,
  parseSnapshotRequest,
  readPullRequestSnapshot,
  type SnapshotSources,
} from './pr-snapshot.js';

const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const TARGET_NOW = 'c'.repeat(40);

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
  headSha: H1,
};

function sources(overrides: Partial<SnapshotSources> = {}): SnapshotSources {
  return {
    repository: REPO,
    viewer: 'bob',
    lookup: () => Promise.resolve({ kind: 'found', pr: ROW }),
    now: () => 1000,
    ...overrides,
  };
}

function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ref: REF,
    repositoryId: 'R_1',
    title: 'Add undo',
    url: ROW.url,
    author: { identifier: 'alice', displayName: 'Alice' },
    lifecycle: { state: 'open', isDraft: false, native: 'OPEN' },
    source: { branch: 'undo', repository: 'acme/app', head: H2 },
    target: { branch: 'main', head: TARGET_NOW },
    createdAt: null,
    updatedAt: null,
    ...over,
  };
}

describe('readPullRequestSnapshot: whose answer this is', () => {
  it('refuses a pull request from a repository other than the open one', async () => {
    // Repo A's #42 asked after the window moved to repo B.
    const other = { ...REF, repository: 'acme/other' };
    await expect(
      readPullRequestSnapshot({ ref: other }, sources())
    ).rejects.toBeInstanceOf(PullRequestIdentityError);
  });

  it('refuses the same number on another provider', async () => {
    const ado = { ...REF, provider: 'azure-devops' };
    await expect(
      readPullRequestSnapshot({ ref: ado }, sources())
    ).rejects.toThrow(/not in github.com\/acme\/app/);
  });

  it('treats host and path case as the providers do', async () => {
    const shouted = { ...REF, host: 'GitHub.com', repository: 'ACME/App' };
    const snap = await readPullRequestSnapshot({ ref: shouted }, sources());
    expect(snap.ref).toEqual(shouted);
  });

  it('refuses a caller that last saw another account', async () => {
    await expect(
      readPullRequestSnapshot({ ref: REF, viewer: 'alice' }, sources())
    ).rejects.toThrow('Signed in as bob now, not alice');
    await expect(
      readPullRequestSnapshot({ ref: REF, viewer: 'BOB' }, sources())
    ).resolves.toMatchObject({ viewer: 'bob' });
  });

  it('refuses when no provider is configured', async () => {
    await expect(
      readPullRequestSnapshot({ ref: REF }, sources({ repository: null }))
    ).rejects.toThrow('No pull request provider is configured');
  });
});

describe('readPullRequestSnapshot: which commits', () => {
  it('reports the list head when the provider has no detail read', async () => {
    const snap = await readPullRequestSnapshot({ ref: REF }, sources());
    expect(snap.detail).toEqual({
      state: 'unsupported',
      reason: 'This provider does not read pull request detail',
    });
    expect(snap.head).toEqual({ oid: H1, from: 'list' });
    expect(snap.target).toBeNull();
  });

  it("prefers the detail's head, and reports its target commit", async () => {
    const snap = await readPullRequestSnapshot(
      { ref: REF },
      sources({ detail: () => Promise.resolve(detail()) })
    );
    expect(snap.head).toEqual({ oid: H2, from: 'detail' });
    expect(snap.target).toBe(TARGET_NOW);
  });

  it('never borrows commits from a detail about another pull request', async () => {
    const stray = detail({ ref: { ...REF, number: 43 } });
    const snap = await readPullRequestSnapshot(
      { ref: REF },
      sources({ detail: () => Promise.resolve(stray) })
    );
    expect(snap.detail).toMatchObject({
      state: 'failed',
      reason: 'The provider answered about github.com/acme/app#43',
    });
    expect(snap.head).toEqual({ oid: H1, from: 'list' });
    expect(snap.target).toBeNull();
  });

  it('keeps a failed detail read as a failure with its kind', async () => {
    const snap = await readPullRequestSnapshot(
      { ref: REF },
      sources({
        detail: () =>
          Promise.reject(
            new VcsError('throttled', 'GitHub asked n10 to slow down', {
              retryAfterMs: 60_000,
            })
          ),
      })
    );
    expect(snap.detail).toEqual({
      state: 'failed',
      kind: 'throttled',
      reason: 'GitHub asked n10 to slow down',
      retryAfterMs: 60_000,
    });
    // The list still names the head.
    expect(snap.head).toEqual({ oid: H1, from: 'list' });
  });

  it('names no head for a pull request neither source knows', async () => {
    const snap = await readPullRequestSnapshot(
      { ref: REF },
      sources({ lookup: () => Promise.resolve({ kind: 'gone' }) })
    );
    expect(snap.summary).toEqual({ kind: 'gone' });
    expect(snap.head).toBeNull();
  });

  it('ignores a list head that is not a full commit id', async () => {
    const snap = await readPullRequestSnapshot(
      { ref: REF },
      sources({
        lookup: () =>
          Promise.resolve({ kind: 'found', pr: { ...ROW, headSha: 'abc123' } }),
      })
    );
    expect(snap.head).toBeNull();
  });
});

describe('parseSnapshotRequest', () => {
  it('accepts a ref with an optional viewer', () => {
    expect(parseSnapshotRequest({ ref: REF, viewer: 'bob' })).toEqual({
      ref: REF,
      viewer: 'bob',
    });
  });

  it.each([
    ['no ref', {}],
    ['a ref without a number', { ref: { ...REF, number: undefined } }],
    ['a fractional number', { ref: { ...REF, number: 4.2 } }],
    ['an empty repository', { ref: { ...REF, repository: '' } }],
    ['a non-string viewer', { ref: REF, viewer: 7 }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseSnapshotRequest(value)).toThrow(TypeError);
  });
});
