/** Bound shell shutdown without adding a deadline to an engine mutation. */
export async function waitForExit(
  stopSync: () => Promise<void>,
  settleRuns: () => Promise<void>,
  graceMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([stopSync(), settleRuns()]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
