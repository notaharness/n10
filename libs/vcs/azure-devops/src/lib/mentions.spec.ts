import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchAdoMentions } from './mentions.js';
import { resetAdoTransport } from './request.js';

const CONFIG = {
  org: 'fabrikam',
  project: 'Fabrikam-Fiber',
  repo: 'app',
  pat: 'test-pat',
};

/** Constructed from the documented Identities shape; see the README. */
const IDENTITIES = readFileSync(
  join(__dirname, '__fixtures__', 'identities-search.json'),
  'utf8'
);

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function answer(body: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  mockFetch.mockReset();
  resetAdoTransport();
});

describe('searchAdoMentions', () => {
  it('offers active people, inserting the identity id Azure stores', async () => {
    mockFetch.mockResolvedValue(answer(IDENTITIES));
    const found = await searchAdoMentions(CONFIG, 'Ja');
    expect(found).toEqual([
      {
        token: '@<8c8c7d32-6b1b-47f4-b2e9-30b477b5ab3d>',
        displayName: 'Jamal Hartnett',
        handle: 'jamalh@fabrikam.com',
      },
      {
        token: '@<d6245f20-2af8-44f4-9451-8107cb2767db>',
        displayName: 'Norman Paulk',
        handle: 'normanp@fabrikam.com',
      },
    ]);
    const url = new URL(String(mockFetch.mock.calls[0]?.[0]));
    expect(url.host).toBe('vssps.dev.azure.com');
    expect(url.pathname).toBe('/fabrikam/_apis/identities');
    expect(url.searchParams.get('searchFilter')).toBe('General');
    expect(url.searchParams.get('filterValue')).toBe('ja');
  });

  it('asks once for the same search typed again', async () => {
    mockFetch.mockResolvedValue(answer(IDENTITIES));
    await searchAdoMentions(CONFIG, 'ja');
    await searchAdoMentions(CONFIG, 'JA ');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('offers nobody when the organization answers nothing', async () => {
    mockFetch.mockResolvedValue(answer('{"count":0,"value":[]}'));
    expect(await searchAdoMentions(CONFIG, 'zz')).toEqual([]);
  });
});
