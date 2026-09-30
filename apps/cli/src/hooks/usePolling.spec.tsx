import { afterEach, expect, it, vi } from 'vitest';
import { Text } from 'ink';
import { render, cleanup } from 'ink-testing-library';
import { usePolling } from '@n10/app-core';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('restarts the sync immediately and rearms the timer when its revision changes', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const read = vi.fn(async () => 1);
  function Harness({ revision }: { revision: number }) {
    const state = usePolling(read, 1_000, true, revision);
    return <Text>{state.value ?? 0}</Text>;
  }
  const view = render(<Harness revision={0} />);
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(600);
  view.rerender(<Harness revision={1} />);
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(400);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(600);
  expect(read).toHaveBeenCalledTimes(3);
  view.unmount();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(read).toHaveBeenCalledTimes(3);
});
