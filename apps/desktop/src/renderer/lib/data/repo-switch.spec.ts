import { MutationObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from './query-keys.js';
import { repoShown, switchStarted, writable } from './repo-switch.js';

/**
 * A write made while the window shows a repository the host is still
 * opening must not reach the repository the host has selected: it waits
 * for the open, and one a failed open caught is refused. Writes go
 * through the app's own query client, as a pane's mutation does.
 */

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<unknown>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function write() {
  const mutationFn = vi.fn(async () => 'written');
  const done = new MutationObserver(queryClient, { mutationFn }).mutate();
  return { mutationFn, done };
}

const flush = async () => {
  for (let n = 0; n < 10; n++) await Promise.resolve();
};

afterEach(() => {
  // Any switch a test left failed ends with its repository back.
  repoShown('/before');
});

describe('writes during a repository switch', () => {
  it('go through at once with no switch in flight', async () => {
    const { mutationFn, done } = write();
    await expect(done).resolves.toBe('written');
    expect(mutationFn).toHaveBeenCalledOnce();
  });

  it('wait for the host to open the repository shown', async () => {
    const open = deferred();
    switchStarted(open.promise, '/before');
    const { mutationFn, done } = write();
    await flush();
    expect(mutationFn).not.toHaveBeenCalled();
    open.resolve({ cwd: '/after' });
    await expect(done).resolves.toBe('written');
    expect(mutationFn).toHaveBeenCalledOnce();
  });

  it('are refused behind a failed open until the repository before is shown again', async () => {
    const open = deferred();
    switchStarted(open.promise, '/before');
    const caught = write();
    open.reject(new Error('Not a git repository'));
    await expect(caught.done).rejects.toThrow(/did not open/);
    expect(caught.mutationFn).not.toHaveBeenCalled();

    // The window has not shown the repository it returned to yet.
    const early = write();
    await expect(early.done).rejects.toThrow(/did not open/);
    expect(early.mutationFn).not.toHaveBeenCalled();
    repoShown('/elsewhere');
    await expect(writable()).rejects.toThrow(/did not open/);

    repoShown('/before');
    const after = write();
    await expect(after.done).resolves.toBe('written');
  });

  it('follow the latest switch, not one it replaced', async () => {
    const first = deferred();
    switchStarted(first.promise, '/before');
    const second = deferred();
    switchStarted(second.promise, '/before');
    const { mutationFn, done } = write();
    first.resolve({ cwd: '/a' });
    await flush();
    expect(mutationFn).not.toHaveBeenCalled();
    second.resolve({ cwd: '/b' });
    await expect(done).resolves.toBe('written');
  });
});
