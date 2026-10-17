import { afterEach, expect, it, vi } from 'vitest';
import { createReadResource, readResourceValue } from './read-resource.js';
import { createResourceCache } from './resource-cache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
afterEach(() => vi.useRealTimers());

it('joins ordinary reads and coalesces forced reads behind the active request', async () => {
  const first = deferred<string>(),
    next = deferred<string>();
  const load = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(next.promise);
  const resource = createReadResource<string>(load, 30_000);
  const active = resource.read();
  expect(resource.read()).toBe(active);
  await flush();
  expect(resource.read(true)).toBe(active);
  expect(resource.read(true)).toBe(active);
  await flush();
  expect(load).toHaveBeenCalledOnce();
  first.resolve('first');
  await flush();
  expect(load).toHaveBeenCalledTimes(2);
  next.resolve('next');
  expect((await active).data).toBe('next');
  const snapshot = resource.getSnapshot();
  expect(await resource.read()).toBe(snapshot);
  expect(load).toHaveBeenCalledTimes(2);
});

it('retains same-scope data on failure and retries immediately', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const load = vi
    .fn()
    .mockResolvedValueOnce('good')
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue('recovered');
  const resource = createReadResource<string>(load, 100);
  await resource.read();
  expect(await resource.read(true)).toMatchObject({
    data: 'good',
    error: 'Offline',
    loading: false,
  });
  expect(await resource.read()).toMatchObject({
    data: 'recovered',
    error: null,
  });
  expect(load).toHaveBeenCalledTimes(3);
});

it('clears old identity data immediately and discards an in-flight answer after reset', async () => {
  const pending = deferred<string>();
  const load = vi
    .fn()
    .mockResolvedValueOnce('old')
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue('new');
  const resource = createReadResource<string>(load, 100);
  await resource.read();
  const active = resource.read(true);
  await flush();
  resource.reset();
  expect(resource.getSnapshot().data).toBeNull();
  const published: (string | null)[] = [];
  resource.subscribe(() => published.push(resource.getSnapshot().data));
  pending.resolve('wrong account');
  expect((await active).data).toBe('new');
  expect(published).not.toContain('wrong account');
});

it('applies a confirmed mutation only to its unchanged base snapshot', async () => {
  const resource = createReadResource(async () => ['first'], 100);
  const base = await resource.read();
  resource.patch(base, (data) => [...data, 'reply']);
  expect(resource.getSnapshot().data).toEqual(['first', 'reply']);
  const beforeSwitch = resource.getSnapshot();
  resource.reset();
  resource.patch(beforeSwitch, (data) => [...data, 'other account']);
  expect(resource.getSnapshot().data).toBeNull();
});

it('never publishes after disposal, even when a read finishes', async () => {
  const pending = deferred<string>();
  const resource = createReadResource(() => pending.promise, 100);
  const listener = vi.fn();
  resource.subscribe(listener);
  const active = resource.read();
  await flush();
  resource.dispose();
  listener.mockClear();
  pending.resolve('late');
  await active;
  expect(listener).not.toHaveBeenCalled();
  expect(resource.getSnapshot().data).toBeNull();
});

it('evicts idle resources while retaining a resource observed on screen', () => {
  const cache = createResourceCache<string>(100, { capacity: 2 });
  const watched = cache.get('watched', async () => 'watched');
  const unsubscribe = watched.subscribe(() => undefined);
  const idle = cache.get('idle', async () => 'idle');
  cache.get('next', async () => 'next');
  expect(cache.get('watched', async () => 'wrong')).toBe(watched);
  expect(cache.get('idle', async () => 'new')).not.toBe(idle);
  unsubscribe();
});

it('releases every idle answer, keeping what is observed or loading', async () => {
  const cache = createResourceCache<string>(100);
  const watched = cache.get('watched', async () => 'watched');
  const unsubscribe = watched.subscribe(() => undefined);
  const idle = cache.get('idle', async () => 'idle');
  await idle.read();
  const pending = deferred<string>();
  const loading = cache.get('loading', () => pending.promise);
  void loading.read();
  cache.release();
  expect(cache.get('watched', async () => 'wrong')).toBe(watched);
  expect(cache.get('loading', async () => 'wrong')).toBe(loading);
  expect(cache.get('idle', async () => 'new')).not.toBe(idle);
  pending.resolve('done');
  unsubscribe();
});

it('serves a parked repository what it holds, reading behind it only past the parked TTL', async () => {
  vi.useFakeTimers();
  let parked = false;
  const freshness = { parked: () => parked, parkedTtl: 3_600_000 };
  const later = deferred<string>();
  const load = vi
    .fn()
    .mockResolvedValueOnce('first')
    .mockReturnValueOnce(later.promise);
  const resource = createReadResource<string>(
    load,
    30_000,
    undefined,
    freshness
  );
  await resource.read();
  parked = true;
  // Past its own TTL, inside the parked one: served, nothing read.
  vi.advanceTimersByTime(60_000);
  expect((await resource.read()).data).toBe('first');
  expect(load).toHaveBeenCalledOnce();
  // Past the parked TTL: served at once, with a read behind it.
  vi.advanceTimersByTime(3_600_000);
  const served = await resource.read();
  expect(served.data).toBe('first');
  expect(load).toHaveBeenCalledTimes(2);
  later.resolve('second');
  await flush();
  expect(resource.getSnapshot().data).toBe('second');
});

it('waits for a parked repository read that has nothing to serve', async () => {
  const freshness = { parked: () => true, parkedTtl: 3_600_000 };
  const resource = createReadResource<string>(
    async () => 'answer',
    30_000,
    undefined,
    freshness
  );
  expect((await resource.read()).data).toBe('answer');
});

it('serves a parked repository its data after a refresh behind it failed', async () => {
  vi.useFakeTimers();
  const freshness = { parked: () => true, parkedTtl: 3_600_000 };
  const load = vi
    .fn()
    .mockResolvedValueOnce('first')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce('second');
  const resource = createReadResource<string>(
    load,
    30_000,
    undefined,
    freshness
  );
  await resource.read();
  vi.advanceTimersByTime(3_600_001);
  expect(await readResourceValue(resource)).toBe('first');
  await flush();
  expect(resource.getSnapshot().error).toBe('offline');
  // The failure stays in the snapshot; the next read still answers.
  expect(await readResourceValue(resource)).toBe('first');
  await flush();
  expect(resource.getSnapshot().data).toBe('second');
});
