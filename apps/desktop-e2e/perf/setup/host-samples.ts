import { readFileSync } from 'node:fs';
import type { ElectronApplication, Page } from '@playwright/test';
import { cpuMs } from './proc-cpu.js';
import { pace } from './pace.js';
import { startMainLag, stopMainLag } from './main-lag.js';

function percentile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  );
}
function hostDelays(
  file: string,
  pid: number,
  start: number,
  end: number
): number[] {
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .flatMap((line) => {
      const row = JSON.parse(line) as {
        pid: number;
        samples: [number, number][];
      };
      return row.pid === pid ? row.samples : [];
    })
    .filter(([at]) => at >= start && at <= end)
    .map(([, delay]) => delay);
}
export async function measureHost(
  app: ElectronApplication,
  page: Page,
  log: string,
  workload: () => Promise<Record<string, number>>
): Promise<Record<string, number>> {
  const processes = () =>
    app.evaluate(({ app: a }) =>
      a.getAppMetrics().map((p) => ({
        pid: p.pid,
        role:
          p.type === 'Browser'
            ? 'main'
            : p.type === 'Tab'
            ? 'renderer'
            : p.type === 'Utility' && p.name === 'n10 host'
            ? 'host'
            : 'other',
        rssMb: (p.memory?.workingSetSize ?? 0) / 1024,
      }))
    );
  const before = await processes();
  const host = before.find((p) => p.role === 'host');
  if (!host) throw new Error('No n10 host utility process to measure');
  const cpuBefore = new Map(before.map((p) => [p.pid, cpuMs(p.pid)]));
  await startMainLag(app);
  const start = Date.now();
  const extra = await workload();
  const end = Date.now();
  const main = await stopMainLag(app);
  const after = await processes();
  if (!after.some((p) => p.pid === host.pid && p.role === 'host'))
    throw new Error('Host process changed during measurement');
  const cpuAfter = new Map(after.map((p) => [p.pid, cpuMs(p.pid)]));
  const result: Record<string, number> = {
    ...extra,
    windowMs: end - start,
    mainLagP99Ms: main.p99,
    mainLagMaxMs: main.max,
  };
  for (const role of ['host', 'main', 'renderer', 'total']) {
    const selected = after.filter((p) => role === 'total' || p.role === role);
    const used = selected.reduce(
      (sum, p) =>
        sum +
        (cpuAfter.get(p.pid) ?? 0) -
        (cpuBefore.get(p.pid) ?? cpuAfter.get(p.pid) ?? 0),
      0
    );
    result[`${role}CpuMs`] = used;
    result[`${role}CorePct`] = (used / (end - start)) * 100;
    result[`${role}RssMb`] = selected.reduce((sum, p) => sum + p.rssMb, 0);
  }
  // Let the host write the completed window; this wait is outside measurement.
  await pace(page, 1100);
  const delays = hostDelays(log, host.pid, start, end);
  if (delays.length < 100)
    throw new Error(`Insufficient host samples: ${delays.length}`);
  return {
    ...result,
    hostSamples: delays.length,
    hostLagP50Ms: percentile(delays, 0.5),
    hostLagP99Ms: percentile(delays, 0.99),
    hostLagMaxMs: Math.max(...delays),
  };
}
