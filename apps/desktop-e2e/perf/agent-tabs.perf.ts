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

/**
 * Many agent tabs open at once: what the renderer pays for the ones
 * nobody is looking at, and how long a switch to one takes.
 *
 * Ten worktrees, each with an agent streaming a line every
 * `INTERVAL_MS`, all open as tabs. One of them printed more than the
 * host's ring buffer holds before it started, so its terminal is the
 * most expensive one to show.
 *
 * A switch is timed from the tab's click to the first animation frame
 * in which the new tab's terminal holds a line its agent printed no
 * earlier than one interval before the click — the screen as it is
 * now, not as it was when the tab was last looked at. The stamp agent
 * writes its checkout and the wall clock into every line so the text
 * alone says both.
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
        document.querySelectorAll('[data-editor-panes] .wterm .term-row')
      ).some((r) => r.textContent?.includes(`@${b}`)),
    branch,
    { timeout: 60_000 }
  );
}

interface Switch {
  /** Click to the first frame with the tab's own terminal grid drawn. */
  gridMs: number;
  /** …with any line of the tab's agent in it, however old. */
  ownMs: number;
  /** …with a line its agent printed no earlier than one interval before
   *  the click: the screen as it is now. */
  currentMs: number;
}

/** Click the tab for `branch` and time it until its terminal shows its
 *  agent's current output. Runs in the page, so Playwright's own round
 *  trips are not in the number. */
async function timedSwitch(page: Page, branch: string): Promise<Switch> {
  return page.evaluate(
    ({ branch: b, freshMs }) =>
      new Promise<Switch>((resolve, reject) => {
        const tabEl = Array.from(
          document.querySelectorAll<HTMLElement>('[role="tab"]')
        ).find((t) => t.textContent?.includes(b));
        if (!tabEl) return reject(new Error(`no tab for ${b}`));
        const pane = '[data-editor-panes] .wterm';
        const before = document.querySelector(pane);
        const tickRe = new RegExp(`tick (\\d+) \\d+ @${b}\\b`);
        const clickedAt = Date.now();
        const t0 = performance.now();
        const at: Partial<Switch> = {};
        tabEl.click();
        const latestIn = (term: Element | null): number => {
          let latest = 0;
          for (const r of Array.from(
            term?.querySelectorAll('.term-row') ?? []
          )) {
            const m = tickRe.exec(r.textContent ?? '');
            if (m) latest = Math.max(latest, Number(m[1]));
          }
          return latest;
        };
        // The terminal the switch mounts is a new element.
        const drawn = (term: Element | null): boolean =>
          term !== before && !!term?.querySelector('.term-row');
        const check = () => {
          const now = performance.now() - t0;
          const term = document.querySelector(pane);
          const latest = latestIn(term);
          if (at.gridMs === undefined && drawn(term)) at.gridMs = now;
          if (at.ownMs === undefined && latest > 0) at.ownMs = now;
          if (latest >= clickedAt - freshMs) {
            resolve({
              gridMs: at.gridMs ?? now,
              ownMs: at.ownMs ?? now,
              currentMs: now,
            });
          } else if (now > 15_000) {
            reject(new Error(`${b} never showed current output`));
          } else {
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      }),
    // One interval, plus the PTY → tmux → host → renderer hop.
    { branch, freshMs: INTERVAL_MS + 150 }
  );
}

/** Renderer and main-process CPU over `windowMs`, as Electron reports
 *  it (percent of one core, averaged since the previous reading). */
async function cpuOver(
  page: Page,
  app: ElectronApplication,
  windowMs: number
): Promise<Record<string, number>> {
  await app.evaluate(({ app: a }) => a.getAppMetrics());
  await pace(page, windowMs);
  return app.evaluate(({ app: a }) => {
    const m = a.getAppMetrics();
    const sum = (type: string | null) =>
      m
        .filter((p) => type === null || p.type === type)
        .reduce((s, p) => s + (p.cpu?.percentCPUUsage ?? 0), 0);
    const renderer = m.find((p) => p.type === 'Tab');
    return {
      rendererCpuPct: sum('Tab'),
      mainCpuPct: sum('Browser'),
      totalCpuPct: sum(null),
      rendererRssMb: (renderer?.memory.workingSetSize ?? NaN) / 1024,
    };
  });
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

/** Lines the active terminal can show, scrollback included. wterm
 *  renders only the rows in view, but sizes its scroller for all of
 *  them. */
async function activeLines(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-editor-panes] .wterm'
    );
    const row = el?.querySelector<HTMLElement>('.term-row');
    if (!el || !row) return NaN;
    return Math.round(el.scrollHeight / row.getBoundingClientRect().height);
  });
}

/** The largest ring buffer the host holds for any agent, read the way
 *  a mounting terminal reads it: a watch, answered, then released. */
async function largestBufferKb(page: Page): Promise<number> {
  return page.evaluate(async () => {
    let most = 0;
    for (const { name } of await window.n10.listSessions()) {
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
    await timedSwitch(page, 'agent-0');
    // Let every agent reach its steady state, and the polls theirs.
    await pace(page, 5000);

    const steady = await cpuOver(page, app.app, IDLE_MS);
    collect(samples, {
      ...steady,
      jsHeapMb: await heapAfterGc(page),
      domNodes: await page.evaluate(
        () => document.querySelectorAll('*').length
      ),
      terminals: await page.evaluate(
        () => document.querySelectorAll('.wterm').length
      ),
      largestBufferKb: await largestBufferKb(page),
    });

    // Plain switches across the ordinary agents.
    const ordinary = branches.filter((b) => b !== BIG);
    let current = 'agent-0';
    for (let i = 0; i < SWITCHES; i++) {
      const next = ordinary[(ordinary.indexOf(current) + 1) % ordinary.length];
      const t = await timedSwitch(page, next);
      collect(samples, {
        switchMs: t.currentMs,
        switchGridMs: t.gridMs,
        switchOwnMs: t.ownMs,
      });
      current = next;
      await pace(page, 400);
    }
    // Into the tab whose scrollback is full, from an ordinary one.
    for (let i = 0; i < Math.ceil(SWITCHES / 2); i++) {
      const t = await timedSwitch(page, BIG);
      collect(samples, {
        bigSwitchMs: t.currentMs,
        bigSwitchGridMs: t.gridMs,
        bigSwitchOwnMs: t.ownMs,
      });
      await pace(page, 400);
      collect(samples, { bigLines: await activeLines(page) });
      await timedSwitch(page, 'agent-0');
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
  saveSamples('agent-tabs', samples);
});
