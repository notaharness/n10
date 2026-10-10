import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { sessionKey } from './setup/session-keys.js';
import { SHOWN_TERMINAL } from './setup/terminal-grid.js';
import { killN10Sessions } from './setup/tmux.js';
import {
  createWorktree,
  focusTerminal,
  launchAgentFromRail,
  visibleText,
} from './setup/app.js';

/**
 * A terminal that mounts from a snapshot the host's ring buffer has
 * cut short (#329). tmux sets its client's terminal up once, as the
 * client attaches: the alternate screen, application cursor keys and
 * bracketed paste. They come in the client's first output and never
 * again, whatever the application in the pane does, so a terminal
 * started without them stays without them: on the normal screen,
 * gathering tmux's scrolling as scrollback, and taking pastes as typed
 * keys. tmux brackets a paste for an application that asked only when
 * the paste reaches it bracketed.
 *
 * The fake agent asks for bracketed paste and cursor keys as Claude
 * Code does, floods the client with more than the ring holds when it
 * is sent a key, and prints each chunk of input it gets. tmux encodes
 * cursor keys for the pane itself, so the agent gets `ESC O A` either
 * way; the mode the terminal sends them in is read from the element it
 * opened in (`data-terminal-cursor-keys`).
 */

const BANNER = 'n10-fake-agent-ready';

/** Two ring buffers' worth: the attach is long gone from the ring. */
const FLOOD = 1024 * 1024;

/** Every chunk of input the agent has printed, in order. */
async function received(page: Page): Promise<string[]> {
  const rows = await page
    .locator(`${SHOWN_TERMINAL} .xterm-rows > div`)
    .allTextContents();
  return rows.flatMap((r) => r.match(/(?<=key:)\S+/g) ?? []);
}

/** Paste `text` into the terminal on screen, as the clipboard would. */
async function pasteText(page: Page, text: string) {
  await focusTerminal(page);
  await page.evaluate((t) => {
    const target = document.activeElement ?? document.body;
    const data = new DataTransfer();
    data.setData('text/plain', t);
    target.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      })
    );
  }, text);
}

test.describe('A terminal mounted from a truncated snapshot', () => {
  test.use({
    n10Config: {
      aiCommand: fakeAgent({ keys: true, modes: true, flood: FLOOD }),
    },
  });

  test.afterEach(({ desktop }) => {
    killN10Sessions(desktop.homeDir);
  });

  test('has the modes the tmux client set as it attached @tmux', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'flooded');
    await launchAgentFromRail(page);
    await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
    await expect(visibleText(page, 'modes-ready')).toBeVisible();
    // The flood starts on a keystroke, through the client now attached.
    await focusTerminal(page);
    await page.keyboard.press('f');
    await expect(visibleText(page, 'flood-done')).toBeVisible({
      timeout: 60_000,
    });
    const name = await sessionKey(page, 'flooded');
    const truncated = await page.evaluate(async (name) => {
      const buffer = await window.n10.watchSession(name);
      await window.n10.unwatchSession(name);
      return buffer.truncated;
    }, name);
    expect(truncated).toBe(true);

    // A reload mounts the terminal again, from that snapshot.
    await page.reload();
    await expect(visibleText(page, 'flood-done')).toBeVisible({
      timeout: 30_000,
    });

    // The alternate screen, which keeps no scrollback for tmux's
    // scrolling to fill, and cursor keys sent in application mode
    // (Up as `ESC O A`).
    const shown = page.locator(SHOWN_TERMINAL);
    await expect(shown).toHaveAttribute('data-terminal-buffer', 'alternate');
    await expect(shown).toHaveAttribute(
      'data-terminal-cursor-keys',
      'application'
    );

    // A multi-line paste reaches the agent bracketed, its newline inside.
    await pasteText(page, 'one\ntwo');
    await expect
      .poll(async () => (await received(page)).join(''), { timeout: 15_000 })
      .toContain('ESC[200~oneCRtwoESC[201~');
  });
});
