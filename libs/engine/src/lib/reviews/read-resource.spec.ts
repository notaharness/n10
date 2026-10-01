import { afterEach, expect, it, vi } from 'vitest';
import { createReadResource } from './read-resource.js';
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
  const cache = createResourceCache<string>(100, 2);
  const watched = cache.get('watched', async () => 'watched');
  const unsubscribe = watched.subscribe(() => undefined);
  const idle = cache.get('idle', async () => 'idle');
  cache.get('next', async () => 'next');
  expect(cache.get('watched', async () => 'wrong')).toBe(watched);
  expect(cache.get('idle', async () => 'new')).not.toBe(idle);
  unsubscribe();
  cache.dispose();
});
