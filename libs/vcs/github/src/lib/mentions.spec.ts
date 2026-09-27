import { describe, expect, it } from 'vitest';
import { MENTIONABLE_USERS_QUERY, searchGitHubMentions } from './mentions.js';

const REPO = { provider: 'github', host: 'github.com', repository: 'acme/app' };

describe('searchGitHubMentions', () => {
  it('asks the repository who can be mentioned, and mentions by login', async () => {
    const asked: unknown[] = [];
    const found = await searchGitHubMentions(
      async (query, variables) => {
        asked.push([query, variables]);
        return {
          data: {
            repository: {
              mentionableUsers: {
                nodes: [
                  { login: 'bea', name: 'Bea Reviewer' },
                  { login: 'bea-bot', name: null },
                  null,
                ],
              },
            },
          },
        };
      },
      REPO,
      'bea'
    );
    expect(asked).toEqual([
      [MENTIONABLE_USERS_QUERY, { owner: 'acme', repo: 'app', q: 'bea' }],
    ]);
    expect(found).toEqual([
      { token: '@bea', displayName: 'Bea Reviewer', handle: 'bea' },
      { token: '@bea-bot', displayName: 'bea-bot', handle: 'bea-bot' },
    ]);
  });
});
