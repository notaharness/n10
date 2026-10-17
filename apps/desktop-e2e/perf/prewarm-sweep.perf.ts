import { expect, test, type Page } from '@playwright/test';
import { cleanupTestRepo, createTestRepo } from '../src/setup/git-repo.js';
import { sidebarRow } from '../src/setup/app.js';
import { launchApp } from './setup/launch.js';
import { saveSamples, type Samples } from './setup/metrics.js';

/**
 * How many panes the editor renders ahead of a press while the pointer
 * sweeps over the sidebar without stopping on anything: pre-warms
 * nobody asked for.
 *
 * Ten worktrees, no agents, and one more open in a tab, so the editor
 * is there to hold a pane. The pointer crosses all ten
 * rows top to bottom at a steady speed, one move per 16 ms frame, then
 * leaves the list at once, so a rest at the end does not count. The
 * page's clock is Playwright's: each frame's 16 ms pass exactly,
 * whatever the machine. `pause` adds a stop of that many ms on every
 * row, as a reader scanning the list would. A pre-warm counts when its
 * pane mounts, so one the editor dropped (a pane let go of still
 * reading) does not.
 */

const ROWS = 10;
const FRAME_MS = 16;
const SWEEPS: { name: string; pxPerSec: number; pause?: number }[] = [
  { name: 'flick 1500 px/s', pxPerSec: 1500 },
  { name: 'fast 600 px/s', pxPerSec: 600 },
  { name: 'steady 200 px/s', pxPerSec: 200 },
  { name: 'slow 60 px/s', pxPerSec: 60 },
  { name: 'scan 600 px/s, 120 ms per row', pxPerSec: 600, pause: 120 },
  // The control: a stop this long on each row warms every row.
  { name: 'stop 600 px/s, 300 ms per row', pxPerSec: 600, pause: 300 },
];
const branches = Array.from({ length: ROWS }, (_, i) => `sweep-${i}`);
const OPEN = 'open-first';

let repoPath: string;

test.beforeAll(() => {
  repoPath = createTestRepo({
    name: 'n10-perf-sweep',
    worktrees: [OPEN, ...branches].map((branch) => ({ branch })),
  });
});

test.afterAll(() => {
  cleanupTestRepo(repoPath);
});

/** Count every pane mounted as the spare from here on. */
async function countSpares(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { spares: number };
    w.spares = 0;
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (n instanceof HTMLElement && n.matches('[data-spare-pane]')) {
            w.spares++;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}

async function sweep(
  page: Page,
  { pxPerSec, pause = 0 }: { pxPerSec: number; pause?: number }
): Promise<number> {
  const centres: number[] = [];
  let x = 0;
  for (const branch of branches) {
    const box = await sidebarRow(
      page,
      new RegExp(`${branch}\\b`)
    ).boundingBox();
    if (!box) throw new Error(`${branch} not laid out`);
    x = box.x + box.width / 2;
    centres.push(box.y + box.height / 2);
  }
  const from = centres[0] - 20;
  const to = centres[ROWS - 1] + 20;
  const step = (pxPerSec * FRAME_MS) / 1000;
  const spares = () =>
    page.evaluate(() => (window as unknown as { spares: number }).spares);

  await page.mouse.move(x, from);
  await page.clock.runFor(500);
  const before = await spares();
  let next = 0;
  for (let y = from; y <= to; y += step) {
    await page.mouse.move(x, y);
    await page.clock.runFor(FRAME_MS);
    if (pause > 0 && next < ROWS && y >= centres[next]) {
      next++;
      await page.clock.runFor(pause);
    }
  }
  // Off the list at once, then long enough for anything pending.
  await page.mouse.move(x + 400, to + 200);
  await page.clock.runFor(500);
  return (await spares()) - before;
}

test('pre-warms fired by a pointer sweeping the sidebar', async () => {
  test.setTimeout(10 * 60_000);
  const perf = await launchApp({ repoPath });
  const samples: Samples = {};
  try {
    const { page } = perf;
    await expect(sidebarRow(page, /sweep-9\b/)).toBeVisible({
      timeout: 60_000,
    });
    await sidebarRow(page, new RegExp(OPEN)).click();
    await expect(page.locator('[data-editor-panes]')).toBeVisible();
    await countSpares(page);
    await page.clock.install();
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
    for (const s of SWEEPS) {
      samples[s.name] = [await sweep(page, s)];
    }
  } finally {
    await perf.close();
  }
  saveSamples('prewarm-sweep', samples);
});
