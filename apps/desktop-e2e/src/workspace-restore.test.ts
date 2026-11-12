import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, tab, tabs, visibleText } from './setup/app.js';
import { tmuxAvailable } from './setup/external.js';
import { shownTerminal } from './setup/prewarm.js';
import { LIFT, motion } from './setup/tab-row.js';
import { startSurvivingTerminal } from './setup/terminals.js';
import { killFixtureSessions, killTmuxSession } from './setup/tmux.js';

/**
 * The tab workspace outlives the app: its order, its pins, the groups
 * the user collapsed and the active tab come back on the next launch
 * from `~/.n10/workspace.json` — tabs with no agent behind them too,
 * which nothing else would reopen. A terminal tab comes back bound to
 * the same tmux session it was saved with.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const SHELL = 'restore-shell';
const SHELL_READY = 'restore-shell-ready';
const SHELL_AGAIN = 'restore-shell-again';

const placeChip = (page: Page) => page.locator('[data-group-chip^="place:"]');
const disclosure = (page: Page) =>
  placeChip(page).locator('[data-group-disclosure]');

/** Whole accessible labels, in strip order; painted text may be cut. */
async function tabLabels(page: Page): Promise<string[]> {
  return Promise.all(
    (await tabs(page).all()).map(
      async (item) =>
        (await item.getAttribute('aria-label')) ??
        (await item.locator('[data-tab-label] .sr-only').textContent()) ??
        ''
    )
  );
}

/**
 * Lift `name`'s tab and step it right once, over `neighbour`. The
 * sensor listens for arrows a task after the lift, so an early press
 * can go unheard; each press is given a second to show before another
 * is tried, so a slow render does not carry the tab a second step.
 */
async function stepRightOver(page: Page, name: RegExp, neighbour: RegExp) {
  await tab(page, name).focus();
  await page.keyboard.press(LIFT);
  const moved = async () => {
    try {
      await expect
        .poll(async () => (await motion(tab(page, neighbour))).transform, {
          timeout: 1_000,
        })
        .toMatch(/^translate3d\(-\d/);
      return true;
    } catch {
      return false;
    }
  };
  for (let tries = 0; tries < 5; tries++) {
    await page.keyboard.press('ArrowRight');
    if (await moved()) return;
  }
  throw new Error(`${String(neighbour)} never slid aside`);
}

/** The saved file, once it says what `ready` asks of it. */
function saved(homeDir: string): Record<string, unknown> | null {
  try {
    const file = JSON.parse(
      readFileSync(join(homeDir, '.n10', 'workspace.json'), 'utf8')
    ) as { workspace: Record<string, unknown> };
    return file.workspace;
  } catch {
    return null;
  }
}

test.describe('Workspace restore', () => {
  let folder = '';

  test.beforeEach(({ desktop }) => {
    folder = mkdtempSync(join(tmpdir(), 'n10-restore-'));
    startSurvivingTerminal({
      name: SHELL,
      cwd: folder,
      command: `printf '%s\\n' ${SHELL_READY}; sleep 300`,
      homeDir: desktop.homeDir,
    });
  });

  test.afterEach(({ desktop }) => {
    killFixtureSessions(desktop.homeDir);
    rmSync(folder, { recursive: true, force: true });
  });

  test('restores its tabs, pins, collapsed groups and order after a restart', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    const shell = tab(page, new RegExp(basename(folder)));
    await expect(shell).toBeVisible({ timeout: 30_000 });
    for (const branch of ['alpha', 'beta', 'gamma'])
      await createWorktree(page, branch);
    await expect
      .poll(() => tabLabels(page))
      .toEqual([basename(folder), 'alpha', 'beta', 'gamma']);

    // Reorder: alpha after beta, by keyboard.
    await stepRightOver(page, /^alpha/, /^beta/);
    await page.keyboard.press('Space');
    await expect
      .poll(() => tabLabels(page))
      .toEqual([basename(folder), 'beta', 'alpha', 'gamma']);

    // Pin gamma: it moves to the strip's start, out of its group.
    await tab(page, /^gamma/).click();
    await page.keyboard.press('Control+Alt+p');
    await expect(page.locator('[role="tab"][data-pinned="true"]')).toHaveCount(
      1
    );
    await expect
      .poll(() => tabLabels(page))
      .toEqual([
        expect.stringMatching(/ · gamma$/),
        basename(folder),
        'beta',
        'alpha',
      ]);

    // The host has written that down.
    await expect
      .poll(() => (saved(homeDir)?.pinned as string[] | undefined)?.length)
      .toBe(1);

    // Collapse the repository's group, beta and alpha behind its chip,
    // and quit at once: the save is still waiting out its debounce, and
    // only the host's shutdown writes it.
    await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'true');
    await disclosure(page).click();
    await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(tab(page, /^beta/)).toHaveCount(0);
    await desktop.relaunch();
    const next = desktop.page;

    const pinned = next.locator('[role="tab"][data-pinned="true"]');
    await expect(pinned).toHaveCount(1, { timeout: 30_000 });
    await expect(pinned).toHaveAttribute('aria-selected', 'true');
    await expect(disclosure(next)).toHaveAttribute('aria-expanded', 'false');
    await expect(tab(next, /^beta/)).toHaveCount(0);
    await disclosure(next).click();
    await expect
      .poll(() => tabLabels(next))
      .toEqual([
        expect.stringMatching(/ · gamma$/),
        basename(folder),
        'beta',
        'alpha',
      ]);

    // The terminal tab is bound to the session it was saved with: it
    // shows that session, once, and is not waiting to reconnect.
    const restored = tab(next, new RegExp(basename(folder)));
    await expect(restored).toHaveCount(1);
    await restored.click();
    await expect(next.locator('[data-terminal-reconnecting]')).toHaveCount(0);
    await expect(shownTerminal(next)).toContainText(SHELL_READY);
  });

  // tmux reuses a name once its session has gone: the tab saved for the
  // old one is not the new one's, and does not take its pin or place.
  test('gives a terminal tab up when its name now runs another session', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    const shell = tab(page, new RegExp(basename(folder)));
    await expect(shell).toBeVisible({ timeout: 30_000 });
    await shell.click();
    await page.keyboard.press('Control+Alt+p');
    await expect(shell).toHaveAttribute('data-pinned', 'true');
    // Saved once discovery has dated its session.
    await expect
      .poll(() => JSON.stringify(saved(homeDir)?.tabs ?? {}))
      .toContain('"created"');
    await expect
      .poll(() => (saved(homeDir)?.pinned as string[] | undefined)?.length)
      .toBe(1);

    await desktop.stop();
    killTmuxSession(SHELL, homeDir);
    // tmux dates a session to the second.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    startSurvivingTerminal({
      name: SHELL,
      cwd: folder,
      command: `printf '%s\\n' ${SHELL_AGAIN}; sleep 300`,
      homeDir,
    });
    await desktop.relaunch();
    const next = desktop.page;

    await expect(
      visibleText(next, '1 session is no longer available')
    ).toBeVisible({ timeout: 30_000 });
    const again = tab(next, new RegExp(basename(folder)));
    await expect(again).toHaveCount(1);
    await expect(again).not.toHaveAttribute('data-pinned', 'true');
    await again.click();
    await expect(next.locator('[data-terminal-reconnecting]')).toHaveCount(0);
    await expect(shownTerminal(next)).toContainText(SHELL_AGAIN);
  });
});
