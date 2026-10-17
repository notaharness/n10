import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewReadFixture } from './review-read-fixture.js';
import { createReviewDraftCommands } from './review-draft-commands.js';

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};
const ALICE = { token: '@alice', displayName: 'Alice', handle: 'alice' };

const env = vi.hoisted(() => ({
  open: true,
  asked: [] as unknown[][],
}));

const fixture = reviewReadFixture(
  () => ({
    repository: {
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
    },
    viewer: 'bob',
    vcsConfigured: true,
    config: {
      vendorAuth: { token: 't' },
      vendorProject: { owner: 'acme', repo: 'app' },
    },
    provider: {
      id: 'github',
      searchMentionCandidates: (...args: unknown[]) => {
        env.asked.push(args);
        return Promise.resolve([ALICE]);
      },
    },
  }),
  () => env.open
);
const { mentions: searchMentionCandidates } = createReviewDraftCommands(
  fixture.options,
  vi.fn()
);

beforeEach(() => {
  env.open = true;
  env.asked = [];
});

describe('searchMentionCandidates', () => {
  it('searches the provider with its credentials for the query', async () => {
    const found = await searchMentionCandidates({ ref: REF, query: 'al' });
    expect(found).toEqual({
      ref: REF,
      viewer: 'bob',
      query: 'al',
      candidates: [ALICE],
    });
    expect(env.asked).toEqual([
      [{ token: 't' }, { owner: 'acme', repo: 'app' }, 'al'],
    ]);
  });

  it('rejects a request without a query before asking anyone', async () => {
    await expect(searchMentionCandidates({ ref: REF })).rejects.toThrow(
      TypeError
    );
    expect(env.asked).toEqual([]);
  });

  it('refuses a repository that is no longer open', async () => {
    env.open = false;
    await expect(
      searchMentionCandidates({ ref: REF, query: 'al' })
    ).rejects.toThrow(/no longer open/);
    expect(env.asked).toEqual([]);
  });
});
