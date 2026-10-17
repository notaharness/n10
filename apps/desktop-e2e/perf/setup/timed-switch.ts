import type { Page } from '@playwright/test';
import { SHOWN_TERMINAL } from '../../src/setup/terminal-grid.js';
import { pace } from './pace.js';

/** Longer than the editor's hover wait. */
const PREWARM_REST_MS = 300;

export interface Switch {
  /** Click to the first frame with the tab's own terminal grid drawn. */
  gridMs: number;
  /** …with any line of the tab's agent in it, however old. */
  ownMs: number;
  /** …with a line its agent printed no earlier than one interval before
   *  the click: the screen as it is now. */
  currentMs: number;
}

/** Press the tab for `branch` with the mouse, as a user does, and time
 *  it from the press until its terminal shows its agent's current
 *  output. With `prewarm`, the pointer first rests on the tab long
 *  enough for the editor to render it ahead of the press. The timing
 *  runs in the page, from its own `pointerdown`, so Playwright's round
 *  trips are not in the number. */
export async function timedSwitch(
  page: Page,
  { prewarm, freshMs }: { prewarm: boolean; freshMs: number },
  branch: string
): Promise<Switch> {
  const target = page.getByRole('tab', { name: new RegExp(`${branch}\\b`) });
  const box = await target.boundingBox();
  if (!box) throw new Error(`no tab for ${branch}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 3,
  });
  if (prewarm) await pace(page, PREWARM_REST_MS);
  // The listener is in place before the press is sent, and the result
  // collected after: sent together, the press can reach the page first.
  await page.evaluate(
    ({ branch: b, freshMs, shown }) => {
      const w = window as unknown as { switchTiming?: Promise<Switch> };
      w.switchTiming = new Promise<Switch>((resolve, reject) => {
        const before = document.querySelector(shown);
        const tickRe = new RegExp(`tick (\\d+) \\d+ @${b}\\b`);
        const at: Partial<Switch> = {};
        const latestIn = (term: Element | null): number => {
          let latest = 0;
          for (const r of Array.from(
            term?.querySelectorAll('.xterm-rows > div') ?? []
          )) {
            const m = tickRe.exec(r.textContent ?? '');
            if (m) latest = Math.max(latest, Number(m[1]));
          }
          return latest;
        };
        // The terminal on screen after the switch is another element:
        // one mounted for it, or the one held ready.
        const drawn = (term: Element | null): boolean =>
          term !== before && !!term?.querySelector('.xterm-rows > div');
        const noPress = setTimeout(
          () => reject(new Error(`the press on ${b} never arrived`)),
          15_000
        );
        window.addEventListener(
          'pointerdown',
          () => {
            clearTimeout(noPress);
            const pressedAt = Date.now();
            const t0 = performance.now();
            const check = () => {
              const now = performance.now() - t0;
              const term = document.querySelector(shown);
              const latest = latestIn(term);
              if (at.gridMs === undefined && drawn(term)) at.gridMs = now;
              if (at.ownMs === undefined && latest > 0) at.ownMs = now;
              if (latest >= pressedAt - freshMs) {
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
          },
          { capture: true, once: true }
        );
      });
    },
    { branch, freshMs, shown: SHOWN_TERMINAL }
  );
  await page.mouse.down();
  await page.mouse.up();
  return page.evaluate(
    () => (window as unknown as { switchTiming: Promise<Switch> }).switchTiming
  );
}
