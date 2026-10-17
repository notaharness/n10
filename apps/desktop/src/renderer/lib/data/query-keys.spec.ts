import { describe, expect, it } from 'vitest';
import { keys, queryClient } from './query-keys.js';

/**
 * What a repository is drawn from stays for the app's life; kinds keyed
 * by a head or a range go an hour after nothing shows them, since each
 * push leaves an entry the key has moved on from.
 */
describe('how long the renderer keeps an answer', () => {
  const gcTime = (key: readonly unknown[]) =>
    queryClient.getQueryDefaults(key).gcTime;

  it('keeps a repository’s rows and pull request reads for the app’s life', () => {
    expect(gcTime(keys.sidebar('/repo'))).toBe(Infinity);
    expect(gcTime(keys.repoInfo('/repo'))).toBe(Infinity);
    expect(gcTime(['pr-snapshot', '/repo'])).toBe(Infinity);
  });

  it('lets a head’s or a range’s answer go an hour after it is last shown', () => {
    for (const kind of ['pr-checks', 'pr-diff-manifest', 'pr-range-manifest'])
      expect(gcTime([kind, '/repo', 'head'])).toBe(60 * 60_000);
  });
});
