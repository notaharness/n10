import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The conversation bridge's own jobs: parse what the renderer sends as
 * untrusted, read through the configured provider, and answer only for
 * the repository that is open. Core's identity checks run for real.
 */

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};

const DONE = { loaded: 0, total: 0, complete: true };

const env = vi.hoisted(() => ({
  configured: true,
  open: true,
  reads: [] as number[],
  onRead: (() => undefined) as () => void,
  supported: true,
}));

vi.mock('@n10/vcs-core', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  configuredRepository: () => ({
    provider: 'github',
    host: 'github.com',
    repository: 'acme/app',
  }),
  readConfig: () => ({
    vendor: 'github',
    vendorProject: { owner: 'acme', repo: 'app', username: 'bob' },
  }),
}));
vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
  activeRepoIs: (cwd: string) => env.open && cwd === '/repo',
}));

vi.mock('./program.js', () => ({
  resolveProvider: () => ({
    config: {
      vendor: 'github',
      vendorAuth: {},
      vendorProject: { owner: 'acme', repo: 'app' },
    },
    configured: env.configured,
    provider: {
      id: 'github',
      fetchPullRequestConversation: env.supported
        ? (_auth: unknown, _project: unknown, prId: number) => {
            env.reads.push(prId);
            env.onRead();
            return Promise.resolve({
              ref: { ...REF, number: prId },
              threads: [],
              comments: [],
              reviews: [],
              events: [],
              coverage: {
                threads: DONE,
                threadComments: DONE,
                comments: DONE,
                reviews: DONE,
                events: DONE,
              },
            });
          }
        : undefined,
    },
  }),
}));

const { getPullRequestConversation } = await import('./pr-conversation.js');

beforeEach(() => {
  env.configured = true;
  env.open = true;
  env.reads = [];
  env.onRead = () => undefined;
  env.supported = true;
});

describe('getPullRequestConversation', () => {
  it.each([
    ['nothing', undefined],
    ['a bare number', 42],
    ['a ref without a host', { ref: { ...REF, host: undefined } }],
    ['a negative number', { ref: { ...REF, number: -1 } }],
  ])('rejects %s before reading anything', async (_label, request) => {
    await expect(getPullRequestConversation(request)).rejects.toThrow(
      TypeError
    );
    expect(env.reads).toEqual([]);
  });

  it('reads the conversation of the pull request asked about', async () => {
    const read = await getPullRequestConversation({ ref: REF });
    expect(env.reads).toEqual([42]);
    expect(read).toMatchObject({
      ref: REF,
      viewer: 'bob',
      conversation: { state: 'read', value: { ref: REF } },
    });
  });

  it('refuses the answer when the repository closed during the read', async () => {
    env.onRead = () => {
      env.open = false;
    };
    await expect(getPullRequestConversation({ ref: REF })).rejects.toThrow(
      /no longer the repository open/
    );
  });

  it('reports an unconfigured provider as unsupported, not empty', async () => {
    env.configured = false;
    const read = await getPullRequestConversation({ ref: REF });
    expect(env.reads).toEqual([]);
    expect(read.conversation.state).toBe('unsupported');
  });
});
