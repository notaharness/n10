import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  sidebarRow,
  tab,
  visibleText,
} from './setup/app.js';
import {
  centre,
  markHeldReady,
  moveTo,
  restOn,
  shownTerminal,
  spareText,
} from './setup/prewarm.js';
import { startLoneShells, startSurvivingTerminal } from './setup/terminals.js';

/**
 * The editor keeps one pane besides the one on screen: the tab the
 * pointer rests on, rendered off screen ahead of the press, or else the
 * tab left last. Pressing that tab shows the pane already there. One at
 * a time, whatever the pointer does.
 */

const BANNER = 'n10-fake-agent-ready';
/** Streams `working <n> @<directory>`. */
const STREAM = fakeAgent({ stream: true, intervalMs: 100, tag: true });

async function launch(page: Page, branch: string): Promise<void> {
  await createWorktree(page, branch);
  await launchAgentFromRail(page);
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
}

/**
 * The streaming agent in a terminal alone in a directory of its own,
 * `<name>-XXXXXX` under the fixture HOME, for each name: tabs that stand
 * on the strip rather than behind a group's chip, as a hover needs. The
 * app finds them in the background; each is opened in turn, so the last
 * is on screen and the one before it was left last.
 */
async function openLoneStreams(
  page: Page,
  homeDir: string,
  names: readonly string[]
): Promise<void> {
  const root = join(homeDir, 'places');
  mkdirSync(root, { recursive: true });
  for (const name of names) {
    startSurvivingTerminal({
      name: `${name}-stream`,
      cwd: mkdtempSync(join(root, `${name}-`)),
      command: STREAM,
      homeDir,
    });
  }
  for (const name of names) {
    const own = tab(page, new RegExp(name));
    await expect(own).toBeVisible({ timeout: 30_000 });
    await own.click();
    await expect(own).toHaveAttribute('aria-selected', 'true');
    await expect(visibleText(page, `@${name}-`)).toBeVisible({
      timeout: 30_000,
    });
  }
}

test.describe('A pane held ready', () => {
  test.use({ n10Config: { aiCommand: STREAM } });

  test.beforeEach(async ({ desktop }) => {
    await openLoneStreams(desktop.page, desktop.homeDir, [
      'alpha',
      'beta',
      'gamma',
    ]);
    await desktop.page.clock.install();
  });

  test('resting on a tab renders it, and pressing it shows that same terminal', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await restOn(page, tab(page, /alpha/));
    await expect.poll(() => spareText(page)).toContain('@alpha');
    await markHeldReady(page);

    await page.mouse.down();
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    const shown = shownTerminal(page);
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
    // Rows to sweep too: the sidebar's, for agents in two worktrees,
    // which share their repository's chip on the strip.
    await launch(page, 'delta');
    await launch(page, 'epsilon');
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
      sidebarRow(page, /delta/),
      tab(page, /beta/),
      sidebarRow(page, /epsilon/),
      tab(page, /gamma/),
      tab(page, /alpha/),
      sidebarRow(page, /delta/),
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
  const { page, homeDir } = desktop;
  // A worktree's tab with no agent closes at once, with no dialog
  // coming up under the pointer. Looking away at a shell alone in its
  // directory leaves it a tab of its own on the strip, and the one
  // left last.
  await createWorktree(page, 'alpha');
  startLoneShells(homeDir, ['beta']);
  const beta = tab(page, /beta/);
  await expect(beta).toBeVisible({ timeout: 30_000 });
  await beta.click();
  await expect(beta).toHaveAttribute('aria-selected', 'true');
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
