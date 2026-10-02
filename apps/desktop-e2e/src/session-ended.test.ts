import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  focusTerminal,
  launchAgentFromRail,
  sessionCard,
  sessionCards,
  sessionMenu,
  tab,
  visibleText,
} from './setup/app.js';
import { findN10SessionFor, killTmuxSession } from './setup/tmux.js';

/**
 * An agent's session can end under its open tab, and what the tab shows
 * follows what tmux keeps. A process that exits leaves its dead pane:
 * the tab keeps it, read-only, with Resume. A session that is gone —
 * stopped from its card, or killed with `tmux kill-session` — leaves
 * nothing: the tab goes back to its no-agent state. Either way the dead
 * PTY's errors never reach the user, even for keystrokes and resizes
 * already on their way.
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

/** Keystrokes, and a window resize that refits the terminal. */
async function typeAndResize(page: Page, app: ElectronApplication) {
  await page.keyboard.type('after the end');
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    const [width = 1280, height = 800] = win.getSize();
    win.setSize(width - 120, height - 80);
  });
}

async function launchAgent(page: Page) {
  await createWorktree(page, BRANCH);
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  await focusTerminal(page);
}

/** The worktree tab, back to having no agent: no card, no terminal,
 *  Launch Agent on offer. */
async function expectNoAgent(page: Page) {
  await expect(sessionCards(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.wterm').filter({ visible: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Launch Agent', exact: true })
  ).toBeVisible();
  await expect(tab(page, BRANCH)).toBeVisible();
}

test.describe('An agent whose process exits', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ exitAfterMs: 3_000 }) } });

  test('keeps its final output, read-only, with Resume', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await launchAgent(page);
    const ipcErrors = await watchForIpcErrors(page);
    await page.keyboard.type('during the end');

    await expect(sessionCard(page, 'Agent')).toContainText('Exited', {
      timeout: 15_000,
    });
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();
    const resume = page.getByRole('button', { name: 'Resume agent' });
    await expect(resume).toBeVisible();
    await focusTerminal(page);
    await typeAndResize(page, app);
    await expect.poll(ipcErrors, { timeout: 3_000 }).toEqual([]);

    await resume.click();
    await expect(sessionMenu(page)).toBeVisible();
  });
});

test.describe('An agent whose tmux session is gone', () => {
  test.use({ n10Config: { aiCommand: fakeAgent() } });

  test('killed from outside, leaves its tab with no agent', async ({
    desktop,
  }) => {
    const { page, app, homeDir } = desktop;
    await launchAgent(page);
    const ipcErrors = await watchForIpcErrors(page);

    const name = findN10SessionFor(BRANCH, homeDir);
    expect(name).toBeDefined();
    killTmuxSession(name!, homeDir);
    await page.keyboard.type('during the end');

    await expectNoAgent(page);
    await typeAndResize(page, app);
    await expect.poll(ipcErrors, { timeout: 3_000 }).toEqual([]);
  });

  test('stopped from its card, leaves its tab with no agent', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await launchAgent(page);
    const ipcErrors = await watchForIpcErrors(page);

    await page
      .getByRole('button', { name: 'Stop agent' })
      .filter({ visible: true })
      .click();
    await page.keyboard.type('during the end');

    await expectNoAgent(page);
    await typeAndResize(page, app);
    await expect.poll(ipcErrors, { timeout: 3_000 }).toEqual([]);
  });
});
