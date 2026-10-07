import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { killN10Sessions } from './setup/tmux.js';
import {
  createWorktree,
  launchAgentFromRail,
  visibleText,
} from './setup/app.js';

/**
 * Mouse reporting from the terminal to the agent. An agent that asks
 * for any-motion tracking (DECSET 1003) — Claude Code does, to
 * highlight what is under the pointer — must be told where the pointer
 * is with no button held, the way a native terminal tells it. The fake
 * agent turns the mode on and prints every SGR report it is sent.
 *
 * While the agent takes the mouse, a click is its and not a text
 * selection, so the pointer is the arrow rather than the I-beam — as in
 * Ghostty.
 */

const BANNER = 'n10-fake-agent-ready';

async function launch(page: Page, branch: string, mode: number) {
  await createWorktree(page, branch);
  await launchAgentFromRail(page);
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
  await expect(visibleText(page, `mouse-ready:${mode}`)).toBeVisible({
    timeout: 15_000,
  });
}

/** Centre of the cell `dx` columns right of the start of the row
 *  holding `text`, measured with wterm's own probe: one `W`. */
async function pointAt(page: Page, text: string, dx = 0) {
  const row = visibleText(page, text);
  const box = await row.boundingBox();
  if (!box) throw new Error(`"${text}" has no box`);
  const charWidth = await row.evaluate((el) => {
    const probe = document.createElement('span');
    probe.textContent = 'W';
    el.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
  return {
    x: box.x + charWidth * (dx + 0.5),
    y: box.y + box.height / 2,
  };
}

/** The pointer shape over the text. */
function cursorOver(page: Page, text: string): Promise<string> {
  return visibleText(page, text).evaluate((el) => getComputedStyle(el).cursor);
}

/** Every mouse report the agent has printed, in order. */
async function reports(page: Page): Promise<string[]> {
  const rows = await page
    .locator('.wterm .term-row')
    .filter({ visible: true })
    .allTextContents();
  return rows.flatMap((r) => r.match(/mouse:\d+;\d+;\d+[Mm]/g) ?? []);
}

/** The cell of the latest no-button motion report, if any. */
async function lastHover(page: Page) {
  const last = (await reports(page))
    .filter((r) => r.startsWith('mouse:35;'))
    .at(-1);
  if (!last) return null;
  const [, col, row] = last.slice('mouse:'.length, -1).split(';').map(Number);
  return { col: col!, row: row! };
}

test.describe('Terminal mouse reporting', () => {
  test.afterEach(({ desktop }) => {
    killN10Sessions(desktop.homeDir);
  });

  test.describe('any-motion tracking (1003)', () => {
    test.use({ n10Config: { aiCommand: fakeAgent({ mouse: 1003 }) } });

    test('hovering with no button held reports the pointer to the agent', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await launch(page, 'hover', 1003);

      const a = await pointAt(page, BANNER, 1);
      const b = await pointAt(page, BANNER, 5);
      // 35 = motion (32) with no button (3). The pointer may already sit
      // over the terminal, so each move waits for its own cell. The
      // banner starts the row: its second character is column 2.
      await page.mouse.move(a.x, a.y);
      await expect
        .poll(async () => (await lastHover(page))?.col, { timeout: 10_000 })
        .toBe(2);
      const atA = (await lastHover(page))!;
      await page.mouse.move(b.x, b.y, { steps: 2 });
      await expect
        .poll(() => lastHover(page), { timeout: 10_000 })
        .toEqual({ col: 6, row: atA.row });

      // Moving within a cell says nothing new: one report per cell. The
      // agent prints in order, so once the next cell's report is in, any
      // report for the moves inside this one would be too.
      const before = (await reports(page)).length;
      await page.mouse.move(b.x + 1, b.y + 1);
      await page.mouse.move(b.x - 1, b.y);
      const c = await pointAt(page, BANNER, 9);
      await page.mouse.move(c.x, c.y);
      await expect
        .poll(() => lastHover(page), { timeout: 10_000 })
        .toEqual({ col: 10, row: atA.row });
      expect(await reports(page)).toHaveLength(before + 1);

      // Any-motion tracking reports buttons too.
      await page.mouse.click(b.x, b.y);
      await expect
        .poll(() => reports(page), { timeout: 10_000 })
        .toContainEqual(expect.stringMatching(/^mouse:0;\d+;\d+m$/));
    });

    test('the pointer is the arrow, not the text cursor', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await launch(page, 'arrow', 1003);
      expect(await cursorOver(page, BANNER)).toBe('default');
    });
  });

  test.describe('button-event tracking (1002)', () => {
    test.use({ n10Config: { aiCommand: fakeAgent({ mouse: 1002 }) } });

    test('hovering reports nothing, a click still does', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await launch(page, 'click', 1002);

      const a = await pointAt(page, BANNER, 1);
      const b = await pointAt(page, BANNER, 5);
      await page.mouse.move(a.x, a.y);
      await page.mouse.move(b.x, b.y, { steps: 2 });
      await page.mouse.click(b.x, b.y);

      await expect
        .poll(() => reports(page), { timeout: 10_000 })
        .toContainEqual(expect.stringMatching(/^mouse:0;\d+;\d+m$/));
      // The press is the first thing the agent heard: no hover before it.
      expect((await reports(page))[0]).toMatch(/^mouse:0;\d+;\d+M$/);
      expect(await cursorOver(page, BANNER)).toBe('default');
    });
  });

  test.describe('no mouse tracking', () => {
    test.use({ n10Config: { aiCommand: fakeAgent() } });

    test('the pointer stays the text cursor for selecting', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await createWorktree(page, 'select');
      await launchAgentFromRail(page);
      await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
      expect(await cursorOver(page, BANNER)).toBe('auto');
    });
  });
});
