import type { Locator, Page } from '@playwright/test';

/**
 * Resting the pointer on things, for the panes the editor holds ready
 * (`lib/tabs/prewarm.tsx` in the renderer). hoverIntent decides a
 * pointer has settled on the page's clock, so these drive that clock.
 */

/** Long enough for a pointer at rest to settle: hoverIntent samples
 *  every 100 ms. */
export const REST_MS = 300;
/** How far ahead of the page's time `restOn` pauses its clock: well past
 *  the time from reading it to the pause, which runs to some 100 ms on a
 *  loaded box. */
const PAUSE_LEAD_MS = 1_000;

export async function centre(target: Locator): Promise<[number, number]> {
  const box = await target.boundingBox();
  if (!box) throw new Error('not laid out');
  return [box.x + box.width / 2, box.y + box.height / 2];
}

export async function moveTo(page: Page, target: Locator): Promise<void> {
  await page.mouse.move(...(await centre(target)), { steps: 4 });
}

/** A spot that is no tab or row: nothing waits to settle under it. */
export const NOWHERE: [number, number] = [5, 5];

/**
 * Rest the pointer on `target` for exactly `ms` of the page's time:
 * the clock stands still while the pointer gets there, runs `ms`, and
 * goes on from there as usual. `away` moves the pointer off before the
 * clock goes on. The pointer sets out from nowhere, or, with
 * `fromHere`, from where it is (inside a hover card it must not leave).
 *
 * The clock can only be paused at a time given in advance, and the
 * page's time runs on while that call is made, so the pause is set well
 * ahead of it. Getting there runs the page's timers early; with the
 * pointer on nothing first, that is only idle time passing.
 */
export async function restOn(
  page: Page,
  target: Locator,
  ms = REST_MS,
  { away = false, fromHere = false } = {}
): Promise<void> {
  if (!fromHere) await page.mouse.move(...NOWHERE);
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
export function spareText(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      document.querySelector<HTMLElement>(
        '[data-spare-pane] [data-terminal-grid]'
      )?.textContent ?? null
  );
}

/** Mark the terminal held ready, to know it again once shown. */
export function markHeldReady(page: Page): Promise<void> {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-spare-pane] [data-terminal-grid]'
    );
    if (el) el.dataset.heldReady = 'yes';
  });
}

/** The one terminal on screen. */
export function shownTerminal(page: Page): Locator {
  return page.locator('[data-terminal-grid]').filter({ visible: true });
}
