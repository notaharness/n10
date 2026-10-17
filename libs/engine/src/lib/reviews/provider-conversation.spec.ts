import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewReadFixture } from './review-read-fixture.js';
import { readResourceValue } from './read-resource.js';

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

const { service } = reviewReadFixture(
  () => ({
    repository: {
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
    },
    viewer: 'bob',
    vcsConfigured: env.configured,
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
  () => env.open
);
async function getPullRequestConversation(request: unknown) {
  return readResourceValue(service.conversation(request));
}

beforeEach(() => {
  service.reset();
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

  it('answers a repository parked during the read', async () => {
    env.onRead = () => {
      env.open = false;
    };
    const read = await getPullRequestConversation({ ref: REF });
    expect(read.conversation.state).toBe('read');
  });

  it('reports an unconfigured provider as unsupported, not empty', async () => {
    env.configured = false;
    const read = await getPullRequestConversation({ ref: REF });
    expect(env.reads).toEqual([]);
    expect(read.conversation.state).toBe('unsupported');
  });
});

it('retries a typed conversation failure immediately', async () => {
  env.onRead = () => {
    throw new Error('offline');
  };
  expect(
    (await getPullRequestConversation({ ref: REF })).conversation.state
  ).toBe('failed');
  env.onRead = () => undefined;
  expect(
    (await getPullRequestConversation({ ref: REF })).conversation.state
  ).toBe('read');
  expect(env.reads).toEqual([42, 42]);
});
