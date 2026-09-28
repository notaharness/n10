import { describe, expect, it } from 'vitest';
import {
  throttledError,
  type PullRequestConversation,
  type PullRequestRef,
} from '@n10/vcs-core';
import {
  readPullRequestConversation,
  type ConversationSources,
} from './pr-conversation.js';
import { PullRequestIdentityError } from './pr-snapshot.js';

const REPO = { provider: 'github', host: 'github.com', repository: 'acme/app' };
const REF: PullRequestRef = { ...REPO, number: 42 };

const DONE = { loaded: 0, total: 0, complete: true };

function conversation(ref: PullRequestRef = REF): PullRequestConversation {
  return {
    ref,
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
  };
}

function sources(
  overrides: Partial<ConversationSources> = {}
): ConversationSources {
  return {
    repository: () => REPO,
    viewer: () => 'bob',
    conversation: () => Promise.resolve(conversation()),
    now: () => 1000,
    ...overrides,
  };
}

describe('readPullRequestConversation', () => {
  it('echoes the ref and the account it read as', async () => {
    const read = await readPullRequestConversation({ ref: REF }, sources());
    expect(read).toEqual({
      ref: REF,
      viewer: 'bob',
      fetchedAt: 1000,
      conversation: { state: 'read', value: conversation() },
    });
  });

  it('refuses repo B’s #42 while repo A is open (Q8)', async () => {
    const other = { ...REF, repository: 'acme/other' };
    await expect(
      readPullRequestConversation({ ref: other }, sources())
    ).rejects.toBeInstanceOf(PullRequestIdentityError);
  });

  it('refuses a caller that last saw another account', async () => {
    await expect(
      readPullRequestConversation({ ref: REF, viewer: 'alice' }, sources())
    ).rejects.toThrow(/acts as bob now, not alice/);
  });

  it('refuses an answer when the repository changed during the read', async () => {
    let open = REPO;
    const src = sources({
      repository: () => open,
      conversation: () => {
        open = { ...REPO, repository: 'acme/other' };
        return Promise.resolve(conversation());
      },
    });
    await expect(
      readPullRequestConversation({ ref: REF }, src)
    ).rejects.toBeInstanceOf(PullRequestIdentityError);
  });

  it('refuses when the account changed during the read', async () => {
    let viewer = 'bob';
    const src = sources({
      viewer: () => viewer,
      conversation: () => {
        viewer = 'carol';
        return Promise.resolve(conversation());
      },
    });
    await expect(
      readPullRequestConversation({ ref: REF, viewer: 'bob' }, src)
    ).rejects.toBeInstanceOf(PullRequestIdentityError);
  });

  it('never lends another pull request’s conversation to this one', async () => {
    const src = sources({
      conversation: () => Promise.resolve(conversation({ ...REF, number: 43 })),
    });
    const read = await readPullRequestConversation({ ref: REF }, src);
    expect(read.conversation).toMatchObject({
      state: 'failed',
      reason: expect.stringContaining('#43'),
    });
  });

  it('keeps a throttled read’s kind and retry time', async () => {
    const src = sources({
      conversation: () => Promise.reject(throttledError('GitHub', 45_000)),
    });
    const read = await readPullRequestConversation({ ref: REF }, src);
    expect(read.conversation).toMatchObject({
      state: 'failed',
      kind: 'throttled',
      retryAfterMs: 45_000,
    });
  });

  it('says so when the provider has no conversation read', async () => {
    const src = sources({ conversation: undefined });
    const read = await readPullRequestConversation({ ref: REF }, src);
    expect(read.conversation.state).toBe('unsupported');
  });
});
