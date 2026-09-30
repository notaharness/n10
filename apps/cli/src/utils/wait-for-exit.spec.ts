import { afterEach, expect, it, vi } from 'vitest';
import { waitForExit } from './wait-for-exit.js';

afterEach(() => vi.useRealTimers());

it('bounds quit even when a sync removal never settles', async () => {
  vi.useFakeTimers();
  const settle = vi.fn(async () => undefined);
  let finished = false;
  const quitting = waitForExit(
    () => new Promise<void>(() => undefined),
    settle,
    3_000
  ).then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(2_999);
  expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(finished).toBe(true);
  expect(settle).toHaveBeenCalledOnce();
  await quitting;
});

it('waits for both kinds of operation and clears the grace timer', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const removal = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let finished = false;
  const quitting = waitForExit(
    () => removal,
    async () => undefined,
    3_000
  ).then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(finished).toBe(false);
  finish();
  await quitting;
  expect(vi.getTimerCount()).toBe(0);
});
