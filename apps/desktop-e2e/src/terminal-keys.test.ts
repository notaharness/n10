import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { SHOWN_TERMINAL } from './setup/terminal-grid.js';
import { killN10Sessions } from './setup/tmux.js';
import {
  createWorktree,
  focusTerminal,
  launchAgentFromRail,
  visibleText,
} from './setup/app.js';

/**
 * Keys whose sequence the terminal chooses itself, as the agent
 * receives them through tmux. The fake agent asks for modifyOtherKeys,
 * as Claude Code does, and prints every chunk of input it gets. tmux
 * passes a modified key on only to an application that asked, and from
 * 3.5 only with `extended-keys` on, which the developer sets themselves
 * (#335), so the test's server has it. tmux re-encodes the key: 3.4
 * passes the terminal's `ESC[13;2u` on, 3.5 and later write it in
 * `extended-keys-format`, `xterm` by default.
 */

/** Shift+Enter as tmux 3.4, and as 3.5+ by default, hand it on. */
const SHIFT_ENTER = /^ESC\[(13;2u|27;2;13~)$/;

const BANNER = 'n10-fake-agent-ready';

/** Every chunk of input the agent has printed, in order. */
async function received(page: Page): Promise<string[]> {
  const rows = await page
    .locator(`${SHOWN_TERMINAL} .xterm-rows > div`)
    .allTextContents();
  return rows.flatMap((r) => r.match(/(?<=key:)\S+/g) ?? []);
}

test.describe('Terminal keys', () => {
  test.use({
    n10Config: { aiCommand: fakeAgent({ keys: true }) },
    tmuxConf: 'set -s extended-keys on\n',
  });

  test.afterEach(({ desktop }) => {
    killN10Sessions(desktop.homeDir);
  });

  test('Shift+Enter reaches the agent as a modified Enter, and Enter as CR', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'keys');
    await launchAgentFromRail(page);
    await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
    await expect(visibleText(page, 'keys-ready')).toBeVisible({
      timeout: 15_000,
    });

    await focusTerminal(page);
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Enter');
    // Shift+Enter is one sequence and nothing else: no CR after it.
    await expect
      .poll(() => received(page), { timeout: 15_000 })
      .toEqual([expect.stringMatching(SHIFT_ENTER), 'CR']);
  });
});
