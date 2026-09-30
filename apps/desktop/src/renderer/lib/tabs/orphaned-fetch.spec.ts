import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { hasOrphanedFetch } from './orphaned-fetch.js';

describe('hasOrphanedFetch', () => {
  const client = new QueryClient();
  afterEach(() => client.clear());

  function pending(): { settle: () => void; promise: Promise<number> } {
    let settle: () => void = () => undefined;
    const promise = new Promise<number>((resolve) => {
      settle = () => resolve(1);
    });
    return { settle, promise };
  }

  it('is a read still running that nothing observes', async () => {
    const read = pending();
    const observer = new QueryObserver(client, {
      queryKey: ['a'],
      queryFn: () => read.promise,
    });
    const stop = observer.subscribe(() => undefined);
    // Observed: the pane that asked is still there.
    expect(hasOrphanedFetch(client)).toBe(false);
    stop();
    // Let go of before it came back.
    expect(hasOrphanedFetch(client)).toBe(true);
    read.settle();
    await read.promise;
    await Promise.resolve();
    expect(hasOrphanedFetch(client)).toBe(false);
  });

  it('is not data at rest, observed or not', async () => {
    await client.fetchQuery({ queryKey: ['b'], queryFn: () => 1 });
    expect(hasOrphanedFetch(client)).toBe(false);
  });
});
