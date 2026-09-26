import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { usePolling, type PollingState } from '@n10/app-core';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Settle promises and let React commit. Its scheduler runs on a real
 *  `setImmediate`, which the fake timers leave alone. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function mountProbe(fetch: () => Promise<number>, intervalMs: number) {
  const outRef: { current: PollingState<number> | null } = { current: null };
  function Probe() {
    const value = usePolling(fetch, intervalMs);
    // Captured in an effect: assigning during render is blocked by the
    // react-hooks/immutability rule.
    useEffect(() => {
      outRef.current = value;
    });
    return <Box />;
  }
  const { unmount } = render(<Probe />);
  return { outRef, unmount };
}

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start a request while one is still out', async () => {
    const first = deferred<number>();
    const fetch = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(2);
    const probe = mountProbe(fetch, 1000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);

    // Ticks that fall while the first request is out would each start
    // another, and whichever finished last would win.
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetch).toHaveBeenCalledTimes(1);

    first.resolve(1);
    await settle();
    expect(probe.outRef.current?.value).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(probe.outRef.current?.value).toBe(2);
    probe.unmount();
  });

  it('runs a refresh asked for mid-request after it, so its result is the one that stays', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const fetch = vi
      .fn<() => Promise<number>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const probe = mountProbe(fetch, 60_000);
    await settle();

    const refreshed = probe.outRef.current!.refresh();
    // Joined to the queue: a second ask while one is waiting adds nothing.
    void probe.outRef.current!.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);

    first.resolve(1);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(probe.outRef.current?.value).toBe(1);
    expect(probe.outRef.current?.loading).toBe(true);

    second.resolve(2);
    await refreshed;
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(probe.outRef.current?.value).toBe(2);
    expect(probe.outRef.current?.loading).toBe(false);
    probe.unmount();
  });
});
