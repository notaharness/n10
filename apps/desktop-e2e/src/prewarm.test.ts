import type { Locator, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  sidebarRow,
  tab,
  visibleText,
} from './setup/app.js';

/**
 * The editor keeps one pane besides the one on screen: the tab the
 * pointer rests on, rendered off screen ahead of the press, or else the
 * tab left last. Pressing that tab shows the pane already there. One at
 * a time, whatever the pointer does.
 */

const BANNER = 'n10-fake-agent-ready';
/** Long enough for a pointer at rest to settle: hoverIntent samples
 *  every 100 ms. */
const REST_MS = 300;
/** How far ahead of the page's time `restOn` pauses its clock: well past
 *  the time from reading it to the pause, which runs to some 100 ms on a
 *  loaded box. */
const PAUSE_LEAD_MS = 1_000;

async function launch(page: Page, branch: string): Promise<void> {
  await createWorktree(page, branch);
  await launchAgentFromRail(page);
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
}

async function centre(target: Locator): Promise<[number, number]> {
  const box = await target.boundingBox();
  if (!box) throw new Error('not laid out');
  return [box.x + box.width / 2, box.y + box.height / 2];
}

async function moveTo(page: Page, target: Locator): Promise<void> {
  await page.mouse.move(...(await centre(target)), { steps: 4 });
}

/** A spot that is no tab or row: nothing waits to settle under it. */
const NOWHERE: [number, number] = [5, 5];

/**
 * Rest the pointer on `target` for exactly `ms` of the page's time:
 * the clock stands still while the pointer gets there, runs `ms`, and
 * goes on from there as usual. `away` moves the pointer off before the
 * clock goes on.
 *
 * The clock can only be paused at a time given in advance, and the
 * page's time runs on while that call is made, so the pause is set well
 * ahead of it. Getting there runs the page's timers early; with the
 * pointer on nothing first, that is only idle time passing.
 */
async function restOn(
  page: Page,
  target: Locator,
  ms = REST_MS,
  { away = false } = {}
): Promise<void> {
  await page.mouse.move(...NOWHERE);
  await page.clock.pauseAt(
    (await page.evaluate(() => Date.now())) + PAUSE_LEAD_MS
  );
  await moveTo(page, target);
  await page.clock.runFor(ms);
  if (away) {
    await page.mouse.move(...NOWHERE);
    await page.clock.runFor(REST_MS);
  }
  await page.clock.resume();
}

/** The terminal in the pane held ready, if any, and what it shows. */
function spareText(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector<HTMLElement>(
        '[data-spare-pane] [data-terminal-grid]'
      )?.textContent ?? null
  );
}

test.describe('A pane held ready', () => {
  test.use({
    n10Config: {
      aiCommand: fakeAgent({ stream: true, intervalMs: 100, tag: true }),
    },
  });

  test.beforeEach(async ({ desktop }) => {
    for (const branch of ['alpha', 'beta', 'gamma']) {
      await launch(desktop.page, branch);
    }
    await desktop.page.clock.install();
  });

  test('resting on a tab renders it, and pressing it shows that same terminal', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await restOn(page, tab(page, /alpha/));
    await expect.poll(() => spareText(page)).toContain('@alpha');
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-spare-pane] [data-terminal-grid]'
      );
      if (el) el.dataset.heldReady = 'yes';
    });

    await page.mouse.down();
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    const shown = page
      .locator('[data-terminal-grid]')
      .filter({ visible: true });
    await expect(shown).toHaveCount(1);
    await expect(shown).toHaveAttribute('data-held-ready', 'yes');
    await page.mouse.up();
  });

  test('moving off before the pointer settles renders nothing', async ({
    desktop,
  }) => {
    const { page } = desktop;
    // Gamma is on screen and beta, left last, is held ready.
    await expect.poll(() => spareText(page)).toContain('@beta');
    await restOn(page, tab(page, /alpha/), 60, { away: true });
    expect(await spareText(page)).toContain('@beta');
  });

  test('a sweep over the tabs and rows holds one pane at most, and a press still opens at once', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await page.evaluate(() => {
      const w = window as unknown as { held: number[] };
      w.held = [];
      const count = () =>
        w.held.push(
          document.querySelectorAll('[data-spare-pane]').length,
          document.querySelectorAll('[data-terminal-grid]').length - 1
        );
      new MutationObserver(count).observe(document.body, {
        childList: true,
        subtree: true,
      });
    });

    const targets = [
      tab(page, /alpha/),
      sidebarRow(page, /beta/),
      tab(page, /beta/),
      sidebarRow(page, /alpha/),
      sidebarRow(page, /gamma/),
      tab(page, /alpha/),
      sidebarRow(page, /beta/),
    ];
    for (let round = 0; round < 2; round++) {
      for (const target of targets) await restOn(page, target, 170);
    }

    await moveTo(page, tab(page, /alpha/));
    const pressed = Date.now();
    await page.mouse.down();
    await expect(
      page
        .locator('[data-terminal-grid]')
        .filter({ visible: true })
        .getByText('@alpha')
        .first()
    ).toBeVisible();
    expect(Date.now() - pressed).toBeLessThan(1000);
    await page.mouse.up();

    const held = await page.evaluate(
      () => (window as unknown as { held: number[] }).held
    );
    expect(held.length).toBeGreaterThan(0);
    expect(Math.max(...held)).toBeLessThanOrEqual(1);
  });
});

test('closing a tab the pointer rests on lets its pane go', async ({
  desktop,
}) => {
  const { page } = desktop;
  // No agents: a tab without one closes at once, with no dialog
  // coming up under the pointer.
  await createWorktree(page, 'alpha');
  await createWorktree(page, 'beta');
  await expect(page.locator('[data-spare-pane]')).toHaveCount(1);
  await page.clock.install();
  await restOn(page, tab(page, /alpha/));
  // A middle click closes a tab without selecting it first.
  await page.mouse.click(...(await centre(tab(page, /alpha/))), {
    button: 'middle',
  });
  await expect(tab(page, /alpha/)).toHaveCount(0);
  await expect(page.locator('[data-spare-pane]')).toHaveCount(0);
});
