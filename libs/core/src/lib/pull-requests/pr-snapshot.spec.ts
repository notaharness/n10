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
    repository: () => REPO,
    viewer: () => 'bob',
    lookup: () => Promise.resolve({ kind: 'found', pr: ROW }),
    now: () => 1000,
    ...overrides,
  };
}

function detail(over: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    ref: { ...REF, id: 'R_1' },
    title: 'Add undo',
    url: ROW.url,
    author: { identifier: 'alice', displayName: 'Alice' },
    lifecycle: { state: 'open', isDraft: false, native: 'OPEN' },
    source: { branch: 'undo', repository: REPO, head: H2 },
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
    ).rejects.toThrow('n10 acts as bob now, not alice');
    await expect(
      readPullRequestSnapshot({ ref: REF, viewer: 'BOB' }, sources())
    ).resolves.toMatchObject({ viewer: 'bob' });
  });

  it('refuses an answer when the repository changed during the reads', async () => {
    // The list is cached per checkout: after a config change the row
    // that comes back is the other repository's.
    let open = REPO;
    const snap = readPullRequestSnapshot(
      { ref: REF },
      sources({
        repository: () => open,
        lookup: () => {
          open = { ...REPO, repository: 'acme/other' };
          return Promise.resolve({ kind: 'found', pr: ROW });
        },
      })
    );
    await expect(snap).rejects.toThrow('the repository open now');
  });

  it('refuses an answer when the account changed during the reads', async () => {
    let viewer = 'bob';
    const snap = readPullRequestSnapshot(
      { ref: REF, viewer: 'bob' },
      sources({
        viewer: () => viewer,
        lookup: () => {
          viewer = 'carol';
          return Promise.resolve({ kind: 'found', pr: ROW });
        },
      })
    );
    await expect(snap).rejects.toThrow('n10 acts as carol now, not bob');
  });

  it('refuses an account change during the reads when the caller named no account', async () => {
    // Omitted or null, the caller still gets an answer read as a single
    // account: the one configured when the read started.
    for (const asked of [{}, { viewer: null }]) {
      let viewer: string | null = null;
      const snap = readPullRequestSnapshot(
        { ref: REF, ...asked },
        sources({
          viewer: () => viewer,
          lookup: () => {
            viewer = 'carol';
            return Promise.resolve({ kind: 'found', pr: ROW });
          },
        })
      );
      await expect(snap).rejects.toThrow(
        'n10 acts as carol now; no account was configured when this was asked'
      );
    }
  });

  it('refuses a caller that saw no account once one is configured', async () => {
    await expect(
      readPullRequestSnapshot({ ref: REF, viewer: null }, sources())
    ).rejects.toThrow('n10 acts as bob now; no account was configured');
    await expect(
      readPullRequestSnapshot(
        { ref: REF, viewer: 'bob' },
        sources({ viewer: () => null })
      )
    ).rejects.toThrow('No account is configured now; this was asked as bob');
  });

  it('echoes only an id the provider named, never the one it was sent', async () => {
    // No detail read confirms anything: the caller's id goes unechoed,
    // so an answer never passes it off as the provider's.
    const unconfirmed = await readPullRequestSnapshot(
      { ref: { ...REF, id: 'R_1' } },
      sources()
    );
    expect(unconfirmed.ref).toEqual(REF);
    const confirmed = await readPullRequestSnapshot(
      { ref: { ...REF, id: 'R_1' } },
      sources({ detail: () => Promise.resolve(detail()) })
    );
    expect(confirmed.ref).toEqual({ ...REF, id: 'R_1' });
  });

  it('refuses a repository that is not the one the caller read before', async () => {
    // Renamed away and replaced by a new repository at the same path.
    await expect(
      readPullRequestSnapshot(
        { ref: { ...REF, id: 'R_OLD' } },
        sources({ detail: () => Promise.resolve(detail()) })
      )
    ).rejects.toThrow('is now a different repository');
  });

  it("returns the repository's id once the detail names it", async () => {
    const snap = await readPullRequestSnapshot(
      { ref: REF },
      sources({ detail: () => Promise.resolve(detail()) })
    );
    expect(snap.ref).toEqual({ ...REF, id: 'R_1' });
  });

  it('refuses when no provider is configured', async () => {
    await expect(
      readPullRequestSnapshot({ ref: REF }, sources({ repository: () => null }))
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
    // Null is "the caller saw no account", which is a constraint;
    // omitted is none.
    expect(parseSnapshotRequest({ ref: REF, viewer: null })).toEqual({
      ref: REF,
      viewer: null,
    });
    expect(parseSnapshotRequest({ ref: REF })).toEqual({ ref: REF });
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
