import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { cleanupTestRepo, createTestRepo } from '../src/setup/git-repo.js';
import { launchAgentFromRail, sidebarRow } from '../src/setup/app.js';
import { launchApp, unthrottle } from './setup/launch.js';
import { pace } from './setup/pace.js';
import { collect, saveSamples, type Samples } from './setup/metrics.js';
import { startMainLag, stopMainLag } from './setup/main-lag.js';
import { cpuMs } from './setup/proc-cpu.js';
import { timedSwitch } from './setup/timed-switch.js';

/**
 * Many agent tabs open at once: what the renderer pays for the ones
 * nobody is looking at, and how long a switch to one takes.
 *
 * Ten worktrees, each with an agent streaming a line every
 * `INTERVAL_MS`, all open as tabs. One of them printed more than the
 * host's ring buffer holds before it started, so its terminal is the
 * most expensive one to show.
 *
 * A switch is timed from the mouse press on the tab to the first
 * animation frame in which the terminal on screen holds a line its
 * agent printed no earlier than one interval before the press — the
 * screen as it is now, not as it was when the tab was last looked at.
 * The stamp agent writes its checkout and the wall clock into every
 * line so the text alone says both. `N10_PERF_PREWARM=1` rests the
 * pointer on the tab first, so the editor holds it ready.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT = join(HERE, 'setup', 'stamp-agent.mjs');
const ITERATIONS = Number(process.env.N10_PERF_ITERATIONS ?? 3);
const TABS = Number(process.env.N10_PERF_TABS ?? 10);
const INTERVAL_MS = 250;
const BACKLOG_KB = 640;
const IDLE_MS = Number(process.env.N10_PERF_IDLE_MS ?? 15_000);
const SWITCHES = Number(process.env.N10_PERF_SWITCHES ?? 20);
const BIG = 'agent-big';
/** Full-screen repaints per second per agent; 0 streams a line per
 *  interval instead. */
const REDRAW_FPS = Number(process.env.N10_PERF_REDRAW_FPS ?? 0);
/** KB the backlog agent prints at once every three seconds; 0 for none. */
const BURST_KB = Number(process.env.N10_PERF_BURST_KB ?? 0);
/** Rest the pointer on each tab before pressing it, so the editor
 *  renders it ahead of the press. */
const PREWARM = process.env.N10_PERF_PREWARM === '1';

const SWITCH = {
  prewarm: PREWARM,
  // One interval, plus the PTY → tmux → host → renderer hop.
  freshMs: INTERVAL_MS + 150,
};

const branches = [
  ...Array.from({ length: TABS - 1 }, (_, i) => `agent-${i}`),
  BIG,
];

async function openAgentTab(page: Page, branch: string): Promise<void> {
  await sidebarRow(page, new RegExp(`${branch}\\b`))
    .first()
    .click();
  await launchAgentFromRail(page);
  await page.waitForFunction(
    (b) =>
      Array.from(
        document.querySelectorAll('[data-editor-panes] .xterm-rows > div')
      ).some((r) => r.textContent?.includes(`@${b}`)),
    branch,
    { timeout: 60_000 }
  );
}

/** Per-process CPU and memory over `windowMs`, with the main
 *  process's timer lag over the same window. CPU is each process's own
 *  clock from `/proc`, in percent of one core. A utility process named
 *  `n10 host` is the session host when there is one; others (the beam
 *  daemon's) count only in the total. */
async function costOver(
  page: Page,
  app: ElectronApplication,
  windowMs: number
): Promise<Record<string, number>> {
  const processes = () =>
    app.evaluate(({ app: a }) =>
      a.getAppMetrics().map((p) => ({
        pid: p.pid,
        role:
          p.type === 'Tab'
            ? 'renderer'
            : p.type === 'Browser'
            ? 'main'
            : p.type === 'Utility' && p.name === 'n10 host'
            ? 'host'
            : 'other',
        rssMb: (p.memory?.workingSetSize ?? 0) / 1024,
      }))
    );
  const before = await processes();
  const cpuBefore = new Map(before.map((p) => [p.pid, cpuMs(p.pid)]));
  const t0 = Date.now();
  await startMainLag(app);
  await pace(page, windowMs);
  const lag = await stopMainLag(app);
  const after = await processes();
  const elapsed = Date.now() - t0;
  const cost: Record<string, number> = {};
  for (const role of ['renderer', 'main', 'host', 'total']) {
    const ps = after.filter((p) => role === 'total' || p.role === role);
    const used = ps.reduce(
      (s, p) => s + cpuMs(p.pid) - (cpuBefore.get(p.pid) ?? cpuMs(p.pid)),
      0
    );
    cost[`${role}CorePct`] = (used / elapsed) * 100;
    cost[`${role}RssMb`] = ps.reduce((s, p) => s + p.rssMb, 0);
  }
  return {
    ...cost,
    mainLagP50Ms: lag.p50,
    mainLagP99Ms: lag.p99,
    mainLagMaxMs: lag.max,
  };
}

async function heapAfterGc(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    return usedSize / (1024 * 1024);
  } finally {
    await cdp.detach();
  }
}

const p = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? NaN;
};

function logPercentiles(samples: Samples, keys: string[]): void {
  for (const key of keys) {
    const xs = samples[key] ?? [];
    console.log(
      `[perf] ${key}: p50 ${p(xs, 0.5).toFixed(1)} ms, p95 ${p(
        xs,
        0.95
      ).toFixed(1)} ms (n=${xs.length})`
    );
  }
}

/** The largest ring buffer the host holds for any agent, read the way
 *  a mounting terminal reads it: a watch, answered, then released. */
async function largestBufferKb(page: Page): Promise<number> {
  return page.evaluate(async () => {
    let most = 0;
    const repo = (await window.n10.getRepo())!.cwd;
    for (const { name } of await window.n10.listSessions(repo)) {
      const { data } = await window.n10.watchSession(name);
      await window.n10.unwatchSession(name);
      most = Math.max(most, data.length);
    }
    return most / 1024;
  });
}

async function measureOnce(repoPath: string, samples: Samples): Promise<void> {
  const app = await launchApp({
    repoPath,
    n10Config: {
      aiCommand: [
        'node',
        AGENT,
        `--interval-ms=${INTERVAL_MS}`,
        `--backlog-kb=${BACKLOG_KB}`,
        `--backlog-match=${BIG}`,
        `--redraw-fps=${REDRAW_FPS}`,
        `--burst-kb=${BURST_KB}`,
      ].join(' '),
    },
  });
  try {
    await unthrottle(app.app);
    const { page } = app;
    await sidebarRow(page, /agent-0/)
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    for (const b of branches) await openAgentTab(page, b);
    await timedSwitch(page, SWITCH, 'agent-0');
    // Let every agent reach its steady state, and the polls theirs.
    await pace(page, 5000);

    const steady = await costOver(page, app.app, IDLE_MS);
    collect(samples, {
      ...steady,
      jsHeapMb: await heapAfterGc(page),
      domNodes: await page.evaluate(
        () => document.querySelectorAll('*').length
      ),
      terminals: await page.evaluate(
        () => document.querySelectorAll('[data-terminal-grid]').length
      ),
      largestBufferKb: await largestBufferKb(page),
    });

    // Plain switches across the ordinary agents, with the main
    // process's lag while it serves them.
    await startMainLag(app.app);
    const ordinary = branches.filter((b) => b !== BIG);
    let current = 'agent-0';
    for (let i = 0; i < SWITCHES; i++) {
      const next = ordinary[(ordinary.indexOf(current) + 1) % ordinary.length];
      const t = await timedSwitch(page, SWITCH, next);
      collect(samples, {
        switchMs: t.currentMs,
        switchGridMs: t.gridMs,
        switchOwnMs: t.ownMs,
      });
      current = next;
      await pace(page, 400);
    }
    const switching = await stopMainLag(app.app);
    collect(samples, {
      switchingLagP50Ms: switching.p50,
      switchingLagP99Ms: switching.p99,
    });
    // Into the tab whose scrollback is full, from an ordinary one — by
    // way of two, so it is never the tab left last, which the editor
    // holds ready without any pre-warming.
    for (let i = 0; i < Math.ceil(SWITCHES / 2); i++) {
      const t = await timedSwitch(page, SWITCH, BIG);
      collect(samples, {
        bigSwitchMs: t.currentMs,
        bigSwitchGridMs: t.gridMs,
        bigSwitchOwnMs: t.ownMs,
      });
      await pace(page, 400);
      await timedSwitch(page, SWITCH, 'agent-0');
      await pace(page, 400);
      await timedSwitch(page, SWITCH, 'agent-1');
      await pace(page, 400);
    }
  } finally {
    await app.close();
  }
}

test('many agent tabs: steady-state cost and switch latency', async () => {
  test.setTimeout(ITERATIONS * 5 * 60_000);
  const repoPath = createTestRepo({
    name: 'n10-perf-tabs',
    worktrees: branches.map((branch) => ({
      branch,
      files: { 'a.ts': 'export const a = 1;\n' },
    })),
  });
  const samples: Samples = {};
  try {
    for (let i = 0; i < ITERATIONS; i++) await measureOnce(repoPath, samples);
  } finally {
    cleanupTestRepo(repoPath);
  }

  logPercentiles(samples, ['switchMs', 'bigSwitchMs']);
  expect(samples.switchMs, 'never recorded').toHaveLength(
    SWITCHES * ITERATIONS
  );
  const load = [
    REDRAW_FPS > 0 ? 'redraw' : '',
    BURST_KB > 0 ? 'burst' : '',
    PREWARM ? 'prewarm' : '',
  ].filter(Boolean);
  saveSamples(['agent-tabs', ...load].join('-'), samples);
});
