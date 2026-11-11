import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, tab } from './setup/app.js';
import { tmuxAvailable } from './setup/external.js';
import { shownTerminal } from './setup/prewarm.js';
import { liftRightOver, tabNames } from './setup/tab-row.js';
import { startSurvivingTerminal } from './setup/terminals.js';
import { killFixtureSessions } from './setup/tmux.js';

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

const placeChip = (page: Page) => page.locator('[data-group-chip^="place:"]');
const disclosure = (page: Page) =>
  placeChip(page).locator('[data-group-disclosure]');

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
      .poll(() => tabNames(page))
      .toEqual([folder, 'alpha', 'beta', 'gamma']);

    // Reorder: alpha after beta.
    await liftRightOver(page, /^alpha/, /^beta/);
    await page.keyboard.press('Space');
    await expect
      .poll(() => tabNames(page))
      .toEqual([folder, 'beta', 'alpha', 'gamma']);

    // Pin gamma: it moves to the strip's start, out of its group.
    await tab(page, /^gamma/).click();
    await page.keyboard.press('Control+Alt+p');
    await expect(tab(page, /^gamma/)).toHaveAttribute('data-pinned', 'true');
    await expect
      .poll(() => tabNames(page))
      .toEqual(['gamma', folder, 'beta', 'alpha']);

    // Collapse the repository's group, beta and alpha behind its chip.
    await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'true');
    await disclosure(page).click();
    await expect(disclosure(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(tab(page, /^beta/)).toHaveCount(0);

    // The host has written it all down.
    await expect
      .poll(() => (saved(homeDir)?.pinned as string[] | undefined)?.length)
      .toBe(1);
    await expect
      .poll(() => Object.values(saved(homeDir)?.collapsed ?? {}))
      .toEqual([true]);

    await desktop.relaunch();
    const next = desktop.page;

    await expect(tab(next, /^gamma/)).toHaveAttribute('data-pinned', 'true', {
      timeout: 30_000,
    });
    await expect(tab(next, /^gamma/)).toHaveAttribute('aria-selected', 'true');
    await expect(disclosure(next)).toHaveAttribute('aria-expanded', 'false');
    await expect(tab(next, /^beta/)).toHaveCount(0);
    await disclosure(next).click();
    await expect
      .poll(() => tabNames(next))
      .toEqual(['gamma', folder, 'beta', 'alpha']);

    // The terminal tab is bound to the session it was saved with: it
    // shows that session, once, and is not waiting to reconnect.
    const restored = tab(next, new RegExp(basename(folder)));
    await expect(restored).toHaveCount(1);
    await restored.click();
    await expect(next.locator('[data-terminal-reconnecting]')).toHaveCount(0);
    await expect(shownTerminal(next)).toContainText(SHELL_READY);
  });
});
