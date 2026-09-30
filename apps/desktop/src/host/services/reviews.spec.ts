import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Verdict commands validate renderer inputs and fail loudly when unavailable.
 *
 * They validate: a PR id arrives from the sandboxed renderer — which
 * renders pull request markdown and provider-hosted images — and ends
 * up interpolated into a provider API path, so it is checked
 * structurally rather than trusted.
 *
 * And they degrade: a repo with no provider, or one that isn't
 * authenticated, is first-class. Reading returns nothing instead of
 * erroring (the TUI's usePrData does the same), while an action the
 * user explicitly took has to fail loudly rather than vanish.
 */

const env = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  configured: true,
  /** Provider capabilities present on the object. */
  capabilities: {
    comments: true,
    replies: true,
    resolve: true,
    description: true,
    verdicts: true,
  },
  calls: [] as { method: string; args: unknown[] }[],
}));

vi.mock('@n10/vcs-core', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readConfig: () => env.config,
}));

vi.mock('./providers.js', () => {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      env.calls.push({ method, args });
      return Promise.resolve(method === 'fetchPullRequests' ? {} : undefined);
    };
  return {
    get PROVIDERS() {
      const p: Record<string, unknown> = {
        id: 'github',
        isConfigured: () => env.configured,
        fetchPullRequests: record('fetchPullRequests'),
      };
      if (env.capabilities.comments) {
        p.fetchCommentThreads = record('fetchCommentThreads');
      }
      if (env.capabilities.replies) p.replyToThread = record('replyToThread');
      if (env.capabilities.resolve) {
        p.setThreadResolved = record('setThreadResolved');
      }
      if (env.capabilities.description) {
        p.fetchPullRequestDescription = record('fetchPullRequestDescription');
      }
      if (env.capabilities.verdicts) {
        p.submitReviewVerdict = record('submitReviewVerdict');
      }
      return [p];
    },
  };
});

const {
  getReviewViewer,
  replyToThread,
  setThreadResolved,
  submitReviewVerdict,
} = await import('./reviews.js');

beforeEach(() => {
  env.config = {
    vendor: 'github',
    vendorAuth: { token: 'tok' },
    vendorProject: { repo: 'n10', username: 'hermann' },
  };
  env.configured = true;
  env.capabilities = {
    comments: true,
    replies: true,
    resolve: true,
    description: true,
    verdicts: true,
  };
  env.calls = [];
});

const called = (method: string) => env.calls.filter((c) => c.method === method);

describe('PR id validation', () => {
  it.each([
    ['a string', '7 OR 1=1'],
    ['a path', '../../admin'],
    ['a float', 2.5],
    ['zero', 0],
    ['a negative', -1],
  ])('refuses %s before it reaches the provider', async (_label, value) => {
    await expect(
      submitReviewVerdict(value as number, 'approve')
    ).rejects.toThrow('Invalid PR id');
    expect(env.calls).toEqual([]);
  });
});

describe('verdicts', () => {
  it('accepts each verdict the UI can produce', async () => {
    for (const v of [
      'approve',
      'approve-with-suggestions',
      'wait-for-author',
      'reject',
    ] as const) {
      await submitReviewVerdict(1, v);
    }
    expect(called('submitReviewVerdict').map((c) => c.args[3])).toEqual([
      'approve',
      'approve-with-suggestions',
      'wait-for-author',
      'reject',
    ]);
  });

  it('refuses a verdict outside the allowlist', async () => {
    await expect(
      submitReviewVerdict(1, 'merge-it-now' as never)
    ).rejects.toThrow('Invalid review verdict');
    expect(called('submitReviewVerdict')).toEqual([]);
  });

  it('fails loudly when no provider is configured', async () => {
    env.configured = false;
    // Unlike reads, a verdict is something the user pressed a button
    // for; swallowing it would look like it had been filed.
    await expect(submitReviewVerdict(1, 'approve')).rejects.toThrow(
      'No review provider is configured'
    );
  });

  it('reports a provider that cannot submit verdicts', async () => {
    env.capabilities.verdicts = false;
    await expect(submitReviewVerdict(1, 'approve')).rejects.toThrow(
      'does not support review verdicts'
    );
  });
});

describe('getReviewViewer', () => {
  it('uses the GitHub username, which is what its reviewer lists carry', () => {
    expect(getReviewViewer()).toEqual({ identifier: 'hermann' });
  });

  it('uses the configured email for other providers', () => {
    env.config = { vendor: 'azure-devops', email: 'me@example.test' };
    expect(getReviewViewer()).toEqual({ identifier: 'me@example.test' });
  });

  it('is null when nothing identifies the viewer', () => {
    // The renderer uses this to patch its own reviewer row optimistically;
    // a wrong guess would mark the wrong person.
    env.config = { vendor: 'github', vendorProject: {} };
    expect(getReviewViewer()).toBeNull();
  });
});

vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
  activeReviewService: () => ({ invalidateProvider: vi.fn() }),
}));
vi.mock('./sidebar.js', () => ({ refreshPrList: vi.fn() }));

it('reports unavailable thread capabilities and passes authenticated requests through', async () => {
  const thread = { id: 'thread' } as never;
  await replyToThread({ prId: 7, thread, body: 'reply' });
  expect(called('replyToThread')[0].args).toEqual([
    { token: 'tok' },
    { repo: 'n10', username: 'hermann' },
    7,
    thread,
    'reply',
  ]);
  env.capabilities.replies = false;
  env.capabilities.resolve = false;
  await expect(
    replyToThread({ prId: 7, thread, body: 'reply' })
  ).rejects.toThrow('does not support replies');
  await expect(
    setThreadResolved({ prId: 7, thread, resolved: true })
  ).rejects.toThrow('does not support thread resolution');
});

it('does not call a provider for thread writes in an unconfigured repository', async () => {
  env.config = {};
  const thread = { id: 'thread' } as never;
  await replyToThread({ prId: 7, thread, body: 'reply' });
  await setThreadResolved({ prId: 7, thread, resolved: true });
  expect(env.calls).toEqual([]);
});
