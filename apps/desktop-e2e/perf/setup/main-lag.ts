import type { ElectronApplication } from '@playwright/test';

/**
 * How late the main process runs a timer, sampled every 10 ms.
 *
 * The main process answers every renderer call and, while it hosts the
 * sessions, parses and relays every chunk of agent output as well. When
 * it is busy, a click waits on it; this is the number that says how
 * long. Read as percentiles of the delay past each 10 ms tick.
 */
export async function startMainLag(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const g = globalThis as unknown as {
      __n10Lag?: { samples: number[]; timer: ReturnType<typeof setInterval> };
    };
    if (g.__n10Lag) clearInterval(g.__n10Lag.timer);
    const samples: number[] = [];
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      samples.push(Math.max(0, now - last - 10));
      last = now;
    }, 10);
    g.__n10Lag = { samples, timer };
  });
}

export async function stopMainLag(
  app: ElectronApplication
): Promise<{ p50: number; p99: number; max: number }> {
  const samples = await app.evaluate(() => {
    const g = globalThis as unknown as {
      __n10Lag?: { samples: number[]; timer: ReturnType<typeof setInterval> };
    };
    if (!g.__n10Lag) return [];
    clearInterval(g.__n10Lag.timer);
    const out = g.__n10Lag.samples;
    delete g.__n10Lag;
    return out;
  });
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? NaN;
  return { p50: at(0.5), p99: at(0.99), max: sorted.at(-1) ?? NaN };
}
