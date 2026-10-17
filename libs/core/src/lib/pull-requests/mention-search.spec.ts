import { describe, expect, it } from 'vitest';
import type { PullRequestRef } from '@n10/vcs-core';
import {
  parseMentionSearchRequest,
  searchMentions,
  type MentionSources,
} from './mention-search.js';
import { PullRequestIdentityError } from './pr-snapshot.js';

const REPO = { provider: 'github', host: 'github.com', repository: 'acme/app' };
const REF: PullRequestRef = { ...REPO, number: 42 };
const ALICE = { token: '@alice', displayName: 'Alice', handle: 'alice' };

function sources(overrides: Partial<MentionSources> = {}): MentionSources {
  return {
    repository: () => REPO,
    viewer: () => 'bob',
    search: () => Promise.resolve([ALICE]),
    ...overrides,
  };
}

describe('searchMentions', () => {
  it('answers with the provider’s candidates for the query asked', async () => {
    const asked: string[] = [];
    const found = await searchMentions(
      { ref: REF, viewer: 'bob', query: 'al' },
      sources({
        search: (q) => {
          asked.push(q);
          return Promise.resolve([ALICE]);
        },
      })
    );
    expect(found).toEqual({
      ref: REF,
      viewer: 'bob',
      query: 'al',
      candidates: [ALICE],
    });
    expect(asked).toEqual(['al']);
  });

  it('refuses another repository’s pull request, and asks nobody', async () => {
    let asked = false;
    await expect(
      searchMentions(
        { ref: { ...REF, repository: 'acme/other' }, query: 'al' },
        sources({
          search: () => {
            asked = true;
            return Promise.resolve([]);
          },
        })
      )
    ).rejects.toBeInstanceOf(PullRequestIdentityError);
    expect(asked).toBe(false);
  });

  it('drops the answer when the account changes during the search', async () => {
    let viewer = 'bob';
    await expect(
      searchMentions(
        { ref: REF, query: 'al' },
        sources({
          viewer: () => viewer,
          search: () => {
            viewer = 'carol';
            return Promise.resolve([ALICE]);
          },
        })
      )
    ).rejects.toBeInstanceOf(PullRequestIdentityError);
  });

  it('says so when the provider cannot search people', async () => {
    await expect(
      searchMentions({ ref: REF, query: 'al' }, sources({ search: undefined }))
    ).rejects.toThrow('Not available for this repository');
  });
});

describe('parseMentionSearchRequest', () => {
  it('takes a ref, a viewer and a query', () => {
    expect(
      parseMentionSearchRequest({ ref: REF, viewer: null, query: 'al' })
    ).toEqual({ ref: REF, viewer: null, query: 'al' });
  });

  it('refuses a query that is missing or longer than any name', () => {
    expect(() => parseMentionSearchRequest({ ref: REF })).toThrow(TypeError);
    expect(() =>
      parseMentionSearchRequest({ ref: REF, query: 'a'.repeat(101) })
    ).toThrow(TypeError);
  });
});
