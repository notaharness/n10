import type { Locator, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { linger } from './setup/linger.js';
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
/** Longer than the editor's hover wait (150 ms). */
const REST_MS = 300;

async function launch(page: Page, branch: string): Promise<void> {
  await createWorktree(page, branch);
  await launchAgentFromRail(page);
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
}

async function restOn(page: Page, target: Locator, ms = REST_MS) {
  const box = await target.boundingBox();
  if (!box) throw new Error('not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 4,
  });
  await linger(page, ms);
}

/** The terminal in the pane held ready, if any, and what it shows. */
function spareText(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector<HTMLElement>('[data-spare-pane] .wterm')
        ?.textContent ?? null
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
  });

  test('resting on a tab renders it, and pressing it shows that same terminal', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await restOn(page, tab(page, /alpha/));
    await expect.poll(() => spareText(page)).toContain('@alpha');
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-spare-pane] .wterm'
      );
      if (el) el.dataset.heldReady = 'yes';
    });

    await page.mouse.down();
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    const shown = page.locator('.wterm').filter({ visible: true });
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
    await restOn(page, tab(page, /alpha/), 60);
    await page.mouse.move(5, 5);
    await linger(page, REST_MS);
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
          document.querySelectorAll('.wterm').length - 1
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

    const box = await tab(page, /alpha/).boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const pressed = Date.now();
    await page.mouse.down();
    await expect(
      page
        .locator('.wterm')
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
