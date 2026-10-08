import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { cleanupTestRepo, createTestRepo } from '../src/setup/git-repo.js';
import { launchAgentFromRail, sidebarRow } from '../src/setup/app.js';
import { createBigRepo } from './setup/big-repo.js';
import {
  launchApp,
  unthrottle,
  type LaunchOptions,
  type PerfApp,
} from './setup/launch.js';
import { measureHost } from './setup/host-samples.js';
import { pace } from './setup/pace.js';
import {
  collect,
  saveSamples,
  waitForBoot,
  type Samples,
} from './setup/metrics.js';

const ITERATIONS = Number(process.env.N10_PERF_ITERATIONS ?? 3);
const WINDOW_MS = 15_000;
const AGENT = join(
  dirname(fileURLToPath(import.meta.url)),
  'setup',
  'stamp-agent.mjs'
);
const BRANCHES = [
  ...Array.from({ length: 9 }, (_, i) => `agent-${i}`),
  'agent-big',
];

async function sampled(
  options: LaunchOptions,
  prepare: (page: Page) => Promise<void>,
  workload: (page: Page) => Promise<Record<string, number>>
): Promise<Record<string, number>> {
  const scratch = mkdtempSync(join(tmpdir(), 'n10-host-probe-'));
  const log = join(scratch, 'samples.jsonl');
  let instance: PerfApp | undefined;
  try {
    instance = await launchApp({ ...options, hostProbeLog: log });
    await unthrottle(instance.app);
    await waitForBoot(instance.page, 30_000);
    await prepare(instance.page);
    await pace(instance.page, 5000);
    const { app, page } = instance;
    return await measureHost(app, page, log, () => workload(page));
  } finally {
    await instance?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function idle(page: Page): Promise<Record<string, number>> {
  await pace(page, WINDOW_MS);
  return {};
}

async function openTerminals(page: Page): Promise<void> {
  for (const branch of BRANCHES) {
    await sidebarRow(page, new RegExp(`${branch}\\b`))
      .first()
      .click();
    await launchAgentFromRail(page);
    await page.waitForFunction(
      (b) =>
        Array.from(
          document.querySelectorAll('[data-editor-panes] .wterm .term-row')
        ).some((row) => row.textContent?.includes(`@${b}`)),
      branch,
      { timeout: 60_000 }
    );
  }
}

for (const load of ['idle', 'light', 'redraw', 'burst'] as const) {
  test(`host workload: ${load}`, async () => {
    test.setTimeout(ITERATIONS * 180_000);
    const repoPath = createTestRepo({
      name: 'n10-host-terminals',
      worktrees: BRANCHES.map((branch) => ({
        branch,
        files: { 'a.ts': 'export const a = 1;\n' },
      })),
    });
    const samples: Samples = {};
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        collect(
          samples,
          await sampled(
            {
              repoPath,
              n10Config: {
                aiCommand: `node ${AGENT} --interval-ms=250 --backlog-kb=640 --backlog-match=agent-big --redraw-fps=${
                  load === 'redraw' ? 10 : 0
                } --burst-kb=${load === 'burst' ? 256 : 0}`,
              },
            },
            load === 'idle' ? async () => undefined : openTerminals,
            idle
          )
        );
      }
    } finally {
      cleanupTestRepo(repoPath);
    }
    expect(samples.hostSamples).toHaveLength(ITERATIONS);
    saveSamples(`host-${load}`, samples);
  });
}

for (const size of [
  { files: 40, linesPerFile: 600 },
  { files: 200, linesPerFile: 2000 },
]) {
  test(`host workload: diff ${size.files}x${size.linesPerFile}`, async () => {
    test.setTimeout(ITERATIONS * 120_000);
    const repo = createBigRepo(size);
    const samples: Samples = {};
    try {
      for (let i = 0; i < ITERATIONS; i++) {
        collect(
          samples,
          await sampled(
            { repoPath: repo.path },
            async () => undefined,
            async (page) => {
              const result = await page.evaluate(async (branch) => {
                const repo = (await window.n10.getRepo())!.cwd;
                const start = performance.now();
                const patch = await window.n10.fetchWorktreeDiffText(
                  repo,
                  branch,
                  'main'
                );
                const firstReadMs = performance.now() - start;
                const cachedStart = performance.now();
                const cached = await window.n10.fetchWorktreeDiffText(
                  repo,
                  branch,
                  'main'
                );
                return {
                  firstReadMs,
                  cachedReadMs: performance.now() - cachedStart,
                  patchBytes: patch.length,
                  cachedBytes: cached.length,
                };
              }, repo.branch);
              expect(result.patchBytes).toBeGreaterThan(100_000);
              expect(result.cachedBytes).toBe(result.patchBytes);
              await pace(page, WINDOW_MS);
              return result;
            }
          )
        );
      }
    } finally {
      repo.cleanup();
    }
    saveSamples(`host-diff-${size.files}x${size.linesPerFile}`, samples);
  });
}
