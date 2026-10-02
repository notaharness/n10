import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  sessionCard,
  visibleText,
} from './setup/app.js';
import { findN10SessionFor, killTmuxSession } from './setup/tmux.js';

/**
 * An agent's session can end under its open tab: stopped from the tab's
 * card, killed from outside with `tmux kill-session`, or exiting on its
 * own. The tab must follow without surfacing the dead PTY's errors to
 * the user, even for keystrokes and resizes already on their way.
 */

const BRANCH = 'ending';

/** Records, from now on, whether any IPC error reached the screen. */
async function watchForIpcErrors(page: Page) {
  await page.evaluate(() => {
    const w = window as { ipcErrors?: string[] };
    w.ipcErrors = [];
    new MutationObserver(() => {
      const text = document.body.innerText;
      const at = text.indexOf('Error invoking remote method');
      if (at >= 0) w.ipcErrors?.push(text.slice(at, at + 160));
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  return () =>
    page.evaluate(() => (window as { ipcErrors?: string[] }).ipcErrors ?? []);
}

/** Keystrokes into the terminal, and a window resize to refit it. */
async function typeAndResize(page: Page, app: ElectronApplication) {
  await page.keyboard.type('after the end');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    const [width = 1280, height = 800] = win.getSize();
    win.setSize(width - 120, height - 80);
  });
}

/** Put the keyboard in the agent's terminal, where it is still shown. */
async function focusTerminal(page: Page) {
  const terminal = page.locator('.wterm').filter({ visible: true }).first();
  if (await terminal.isVisible()) await terminal.click();
}

async function launchAgent(page: Page) {
  await createWorktree(page, BRANCH);
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  await focusTerminal(page);
}

test.use({ n10Config: { aiCommand: fakeAgent() } });

test('a session killed from outside ends quietly under its tab', async ({
  desktop,
}) => {
  const { page, app, homeDir } = desktop;
  await launchAgent(page);
  const ipcErrors = await watchForIpcErrors(page);

  const name = findN10SessionFor(BRANCH, homeDir);
  expect(name).toBeDefined();
  killTmuxSession(name!, homeDir);
  await page.keyboard.type('during the end');
  await expect(sessionCard(page, 'Agent')).toContainText('Exited', {
    timeout: 15_000,
  });
  await focusTerminal(page);
  await typeAndResize(page, app);

  await expect.poll(ipcErrors, { timeout: 3_000 }).toEqual([]);
});

test('an agent stopped from its card ends quietly under its tab', async ({
  desktop,
}) => {
  const { page, app } = desktop;
  await launchAgent(page);
  const ipcErrors = await watchForIpcErrors(page);

  await page
    .getByRole('button', { name: 'Stop agent' })
    .filter({ visible: true })
    .click();
  await focusTerminal(page);
  await page.keyboard.type('during the end');
  await expect(sessionCard(page, 'Agent')).toContainText('Exited', {
    timeout: 15_000,
  });
  await focusTerminal(page);
  await typeAndResize(page, app);

  await expect.poll(ipcErrors, { timeout: 3_000 }).toEqual([]);
});
