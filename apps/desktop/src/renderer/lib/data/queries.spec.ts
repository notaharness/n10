import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  DesktopPrefs,
  N10HostApi,
  RepoInfo,
  SidebarItem,
} from '../../../host/contract.js';
import { keys, resetRepoScopedCache } from './query-keys.js';
import {
  loadWorktreeRemovalCheck,
  loadRepoGate,
  loadSidebarModel,
  machinesQuery,
  refreshRepoInfo,
} from './queries.js';
import {
  loadPullRequestSnapshot,
  pullRequestRefFor,
} from './pr-snapshot-query.js';
import {
  loadPullRequestConversation,
  ProviderReadError,
  retryRead,
} from './pr-conversation-query.js';

/**
 * The renderer runs in a browser; these tests run in node. Only the
 * handful of bridge calls each case exercises is stubbed — anything
 * else being reached is itself a failure worth seeing.
 */
function stubHost(api: Partial<N10HostApi>): void {
  (globalThis as { window?: unknown }).window = { n10: api };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const REPO: RepoInfo = {
  cwd: '/repo',
  providerId: null,
  vcsConfigured: false,
  repository: null,
  viewer: null,
};

/** The value of `p`, or 'pending' if it has not settled by the time
 *  every already-queued task has run. */
async function state(p: Promise<unknown>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 0));
  return Promise.race([p, Promise.resolve('pending')]);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('loadRepoGate', () => {
  it('reports no repository when the host cannot name one', async () => {
    stubHost({
      refreshRepo: () => Promise.reject(new Error('host is not ready')),
      getDesktopPrefs: () =>
        Promise.resolve({
          theme: 'system' as const,
          nativeFrame: false,
          tabOverflow: 'wrap' as const,
        }),
    });

    // A rejection here must not surface as a failed query: the gate
    // would sit on its loading screen forever instead of falling
    // through to the repo picker.
    await expect(loadRepoGate()).resolves.toBeNull();
  });

  it('waits for the desktop prefs before reporting the repository', async () => {
    const prefs = deferred<DesktopPrefs>();
    stubHost({
      refreshRepo: () => Promise.resolve(REPO),
      getDesktopPrefs: () => prefs.promise,
    });

    const gate = loadRepoGate();

    // The repo is known, but the theme and frame the workspace paints
    // with are not — resolving now would paint the wrong one first.
    expect(await state(gate)).toBe('pending');

    prefs.resolve({ theme: 'system', nativeFrame: false, tabOverflow: 'wrap' });
    expect(await gate).toEqual(REPO);
  });

  it('reports the repository even when the prefs cannot be read', async () => {
    stubHost({
      refreshRepo: () => Promise.resolve(REPO),
      getDesktopPrefs: () => Promise.reject(new Error('no prefs file')),
    });

    await expect(loadRepoGate()).resolves.toEqual(REPO);
  });
});

describe('pull request snapshots', () => {
  const GITHUB = {
    provider: 'github',
    host: 'github.com',
    repository: 'acme/app',
  };
  const REF = { ...GITHUB, number: 42 };

  it('qualifies a number with the open repository, or not at all', () => {
    expect(pullRequestRefFor({ ...REPO, repository: GITHUB }, 42)).toEqual(REF);
    expect(pullRequestRefFor(REPO, 42)).toBeNull();
    // 0 is a worktree without a pull request.
    expect(pullRequestRefFor({ ...REPO, repository: GITHUB }, 0)).toBeNull();
  });

  it('asks as the account it knows, and keeps an answer about that pull request', async () => {
    const asked: unknown[] = [];
    stubHost({
      getPullRequestSnapshot: (req) => {
        asked.push(req);
        return Promise.resolve({ ref: req.ref, viewer: 'bob' } as never);
      },
    });
    await expect(loadPullRequestSnapshot(REF, 'bob')).resolves.toMatchObject({
      ref: REF,
    });
    expect(asked).toEqual([{ ref: REF, viewer: 'bob' }]);
  });

  it('says so when it knows no account, rather than leaving the account open', async () => {
    const asked: unknown[] = [];
    stubHost({
      getPullRequestSnapshot: (req) => {
        asked.push(req);
        return Promise.resolve({ ref: req.ref, viewer: null } as never);
      },
    });
    await loadPullRequestSnapshot(REF, null);
    expect(asked).toEqual([{ ref: REF, viewer: null }]);
  });

  it('refuses an answer read as another account (Q8)', async () => {
    stubHost({
      getPullRequestSnapshot: (req) =>
        Promise.resolve({ ref: req.ref, viewer: 'carol' } as never),
    });
    await expect(loadPullRequestSnapshot(REF, 'bob')).rejects.toThrow(
      'Expected an answer read as bob, got one read as carol'
    );
    await expect(loadPullRequestSnapshot(REF, null)).rejects.toThrow(
      'Expected an answer read as no account, got one read as carol'
    );
  });

  it('files each repository, pull request, known repository id and account apart (Q8)', () => {
    const key = (ref: typeof REF & { id?: string }, viewer = 'bob') =>
      JSON.stringify(keys.prSnapshot('/repo', ref, viewer));
    const all = [
      key(REF),
      key({ ...REF, repository: 'acme/lib' }),
      key({ ...REF, number: 43 }),
      key({ ...REF, id: 'R_OLD' }),
      key({ ...REF, id: 'R_NEW' }),
      key(REF, 'carol'),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('never serves a replaced repository the entry of the one it replaced (Q8)', async () => {
    // Same path, number and account; the repository at that path is a
    // different one now. A fresh entry must be read, not the old one's.
    const qc = new QueryClient();
    const read = (ref: typeof REF & { id: string }) =>
      qc.query({
        queryKey: keys.prSnapshot('/repo', ref, 'alice'),
        queryFn: () => Promise.resolve({ ref }),
        staleTime: 0,
      });
    await read({ ...REF, id: 'R_OLD' });
    await expect(read({ ...REF, id: 'R_NEW' })).resolves.toEqual({
      ref: { ...REF, id: 'R_NEW' },
    });
  });

  it('drops every snapshot with the repository it belonged to', () => {
    const qc = new QueryClient();
    qc.setQueryData(keys.prSnapshot('/repo', REF, 'bob'), { ref: REF });
    resetRepoScopedCache(qc);
    expect(
      qc.getQueryData(keys.prSnapshot('/repo', REF, 'bob'))
    ).toBeUndefined();
  });

  it('refuses an answer that names another pull request', async () => {
    stubHost({
      getPullRequestSnapshot: () =>
        Promise.resolve({ ref: { ...REF, repository: 'acme/lib' } } as never),
    });
    await expect(loadPullRequestSnapshot(REF, null)).rejects.toThrow(
      'Expected an answer about github.com/acme/app#42, got one about github.com/acme/lib#42'
    );
  });
});

describe('refreshRepoInfo', () => {
  const GITHUB_REPO: RepoInfo = {
    cwd: '/repo',
    providerId: 'github',
    vcsConfigured: true,
    repository: {
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
    },
    viewer: 'bob',
  };

  function seeded(repo: RepoInfo) {
    const qc = new QueryClient();
    qc.setQueryData(keys.repo, repo);
    qc.setQueryData(keys.threads('/repo', 42), { threads: [] });
    qc.setQueryData(keys.sidebar('/repo'), ['row']);
    qc.setQueryData(keys.settings('/repo'), { fields: [] });
    qc.setQueryData(keys.diff('/repo', 'undo', 'main'), 'patch');
    return qc;
  }

  it.each([
    ['the account', { viewer: 'carol' }],
    [
      'the repository',
      {
        repository: {
          provider: 'github',
          host: 'github.com',
          repository: 'acme/lib',
        },
      },
    ],
    ['the provider', { providerId: 'azure-devops' }],
  ])(
    'adopts a change of %s and drops what the provider answered before it',
    async (_label, change) => {
      const next = { ...GITHUB_REPO, ...change };
      stubHost({ getRepo: () => Promise.resolve(next) });
      const qc = seeded(GITHUB_REPO);

      await refreshRepoInfo(qc);

      expect(qc.getQueryData(keys.repo)).toEqual(next);
      expect(qc.getQueryData(keys.threads('/repo', 42))).toBeUndefined();
      expect(qc.getQueryData(keys.sidebar('/repo'))).toBeUndefined();
      // The settings page that made the change keeps its answer, and
      // git's diff never came from the provider.
      expect(qc.getQueryData(keys.settings('/repo'))).toEqual({ fields: [] });
      expect(qc.getQueryData(keys.diff('/repo', 'undo', 'main'))).toBe('patch');
    }
  );

  it('keeps what was read when the identity is unchanged', async () => {
    // The same provider and repository, and the account only re-cased,
    // which both providers treat as the same login or email.
    const next = { ...GITHUB_REPO, viewer: 'BOB' };
    stubHost({ getRepo: () => Promise.resolve(next) });
    const qc = seeded(GITHUB_REPO);

    await refreshRepoInfo(qc);

    expect(qc.getQueryData(keys.repo)).toEqual(next);
    expect(qc.getQueryData(keys.threads('/repo', 42))).toEqual({ threads: [] });
  });

  it('leaves a repository switch to the gate', async () => {
    stubHost({
      getRepo: () => Promise.resolve({ ...GITHUB_REPO, cwd: '/other' }),
    });
    const qc = seeded(GITHUB_REPO);

    await refreshRepoInfo(qc);

    expect(qc.getQueryData(keys.repo)).toEqual(GITHUB_REPO);
    expect(qc.getQueryData(keys.threads('/repo', 42))).toEqual({ threads: [] });
  });
});

describe('pull request conversations', () => {
  const REF = {
    provider: 'github',
    host: 'github.com',
    repository: 'acme/app',
    number: 42,
  };

  it('resolves with a conversation the provider read', async () => {
    const asked: unknown[] = [];
    stubHost({
      getPullRequestConversation: (req) => {
        asked.push(req);
        return Promise.resolve({
          ref: req.ref,
          viewer: 'bob',
          fetchedAt: 1,
          conversation: { state: 'read', value: {} },
        } as never);
      },
    });
    await expect(
      loadPullRequestConversation(REF, 'bob')
    ).resolves.toMatchObject({ conversation: { state: 'read' } });
    expect(asked).toEqual([{ ref: REF, viewer: 'bob' }]);
  });

  it('rejects a failed read with its kind and retry time, never empty data', async () => {
    stubHost({
      getPullRequestConversation: (req) =>
        Promise.resolve({
          ref: req.ref,
          viewer: 'bob',
          fetchedAt: 1,
          conversation: {
            state: 'failed',
            kind: 'throttled',
            reason: 'GitHub is rate limiting n10',
            retryAfterMs: 30_000,
          },
        } as never),
    });
    const failure = loadPullRequestConversation(REF, 'bob');
    await expect(failure).rejects.toBeInstanceOf(ProviderReadError);
    await expect(failure).rejects.toMatchObject({
      message: 'GitHub is rate limiting n10',
      kind: 'throttled',
      retryAfterMs: 30_000,
    });
  });

  it('refuses an answer that names another pull request', async () => {
    stubHost({
      getPullRequestConversation: () =>
        Promise.resolve({ ref: { ...REF, number: 43 } } as never),
    });
    await expect(loadPullRequestConversation(REF, null)).rejects.toThrow(
      /got one about github.com\/acme\/app#43/
    );
  });

  it('refuses an answer read as another account', async () => {
    stubHost({
      getPullRequestConversation: (req) =>
        Promise.resolve({ ref: req.ref, viewer: 'carol' } as never),
    });
    await expect(loadPullRequestConversation(REF, 'bob')).rejects.toThrow(
      /read as carol/
    );
  });

  it('does not ask again straight away after a rate limit or a rejected credential', () => {
    const failure = (kind: 'throttled' | 'auth' | 'server') =>
      new ProviderReadError('no', kind, undefined);
    expect(retryRead(0, failure('throttled'))).toBe(false);
    expect(retryRead(0, failure('auth'))).toBe(false);
    expect(retryRead(0, failure('server'))).toBe(true);
    expect(retryRead(3, failure('server'))).toBe(false);
  });

  it('files repo A #42 and repo B #42 apart and drops both with the repository (Q8)', () => {
    const a = REF;
    const b = { ...REF, repository: 'acme/lib' };
    expect(keys.prConversation('/repo', a, 'bob')).not.toEqual(
      keys.prConversation('/repo', b, 'bob')
    );
    const qc = new QueryClient();
    qc.setQueryData(keys.prConversation('/repo', a, 'bob'), { ref: REF });
    resetRepoScopedCache(qc);
    expect(
      qc.getQueryData(keys.prConversation('/repo', a, 'bob'))
    ).toBeUndefined();
  });
});

describe('loadWorktreeRemovalCheck', () => {
  it('passes the host verdict through', async () => {
    stubHost({
      checkWorktreeRemoval: () =>
        Promise.resolve({
          verdict: 'refused',
          reason: 'rebase in progress',
          tip: 'abc123',
          repo: '/repo/.git',
          checkout: '/repo/wt',
        }),
    });

    await expect(loadWorktreeRemovalCheck('wip')).resolves.toEqual({
      verdict: 'refused',
      reason: 'rebase in progress',
      tip: 'abc123',
      repo: '/repo/.git',
      checkout: '/repo/wt',
    });
  });

  it('refuses when the host call fails, rather than failing', async () => {
    stubHost({
      checkWorktreeRemoval: () =>
        Promise.reject(new Error('not a git repository')),
    });

    // The dialog only ever reads this value. A rejection left as query
    // error state would leave `data` undefined, which is the same shape
    // as "still loading" — and an unanswerable question must refuse,
    // not offer a confirm button.
    await expect(loadWorktreeRemovalCheck('wip')).resolves.toEqual({
      verdict: 'refused',
      reason: 'not a git repository',
      tip: null,
      repo: null,
      checkout: null,
    });
  });
});

describe('resetRepoScopedCache', () => {
  function seeded() {
    const qc = new QueryClient();
    qc.setQueryData(keys.repo, REPO);
    qc.setQueryData(keys.sidebar('/repo'), ['row']);
    qc.setQueryData(keys.settings('/repo'), { fields: [] });
    qc.setQueryData(keys.threads('/repo', 7), { threads: [] });
    qc.setQueryData(keys.version, { app: '1', electron: '2' });
    qc.setQueryData(keys.terminals, [{ name: 'n10-shell' }]);
    qc.getMutationCache().build(qc, { mutationFn: () => Promise.resolve(1) });
    return qc;
  }

  // Terminals belong to directories, not to the repository being left;
  // dropping them would blank every terminal tab on a switch until the
  // next poll, and a restored terminal's tab is opened off this list.
  it('keeps the terminal listing, which no repository owns', () => {
    const qc = seeded();
    resetRepoScopedCache(qc);
    expect(qc.getQueryData(keys.terminals)).toEqual([{ name: 'n10-shell' }]);
  });

  it('keeps the open repository so the gate never blanks', () => {
    const qc = seeded();

    resetRepoScopedCache(qc);

    // Dropping this entry would drop the gate's observer back into its
    // pending state, flashing "Connecting to host…" between the repo
    // being left and the one being opened.
    expect(qc.getQueryData(keys.repo)).toEqual(REPO);
  });

  it('drops everything that belonged to the repository being left', () => {
    const qc = seeded();

    resetRepoScopedCache(qc);

    expect(qc.getQueryData(keys.sidebar('/repo'))).toBeUndefined();
    expect(qc.getQueryData(keys.settings('/repo'))).toBeUndefined();
    expect(qc.getQueryData(keys.threads('/repo', 7))).toBeUndefined();
    expect(qc.getQueryData(keys.version)).toBeUndefined();
  });

  it('drops in-flight mutation state', () => {
    const qc = seeded();
    expect(qc.getMutationCache().getAll()).toHaveLength(1);

    resetRepoScopedCache(qc);

    // A worktree removal pending in the old repo would otherwise keep
    // hiding a same-named sidebar row in the new one.
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
  });
});

describe('loadSidebarModel', () => {
  const row = (name: string): SidebarItem => ({
    kind: 'session',
    session: { name, running: true },
    branch: name,
    isMerged: false,
  });

  it('takes the rows when the host answers for this repository', async () => {
    stubHost({
      getSidebarModel: () =>
        Promise.resolve({ cwd: '/repo', items: [row('feature')] }),
    });
    await expect(loadSidebarModel('/repo', [row('old')])).resolves.toEqual([
      row('feature'),
    ]);
  });

  it('keeps the rows it had when the host answers for another one', async () => {
    // The state a repo switch passes through: the host has moved on,
    // this workspace is still polling. The other repository's rows
    // must never reach this repository's tabs.
    stubHost({
      getSidebarModel: () =>
        Promise.resolve({ cwd: '/elsewhere', items: [row('theirs')] }),
    });
    await expect(loadSidebarModel('/repo', [row('mine')])).resolves.toEqual([
      row('mine'),
    ]);
  });

  it('shows nothing rather than another repository’s rows on a first poll', async () => {
    stubHost({
      getSidebarModel: () =>
        Promise.resolve({ cwd: '/elsewhere', items: [row('theirs')] }),
    });
    await expect(loadSidebarModel('/repo', undefined)).resolves.toEqual([]);
  });
});

describe('machinesQuery', () => {
  it('leaves the list to the push rather than polling it often', () => {
    // `StatusBar` is always mounted and calls `useMachines`
    // unconditionally, so this interval is every install's baseline
    // IPC traffic — including the local-only installs D8 hides every
    // machines surface from, whose one machine cannot change. Real
    // changes arrive on `onMachinesChanged`; this only catches a push
    // that never came.
    expect(machinesQuery().refetchInterval).toBeGreaterThanOrEqual(60_000);
  });
});
