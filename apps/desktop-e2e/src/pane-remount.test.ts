import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  focusTerminal,
  openRoster,
  visibleText,
} from './setup/app.js';
import { tmuxAvailable } from './setup/external.js';
import { armContextMenuChoice } from './setup/menu.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
} from './setup/terminals.js';

/**
 * A pane's content stays mounted while the layout changes around it:
 * the sole pane becoming one half of a split, and a split collapsing
 * back to the pane that is left. The terminal it shows is the same
 * element throughout, with its focus, rather than one rebuilt from the
 * host's snapshot.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const panes = (page: Page) => page.locator('[data-pane-id]');

type Marked = Window & {
  kept?: { grid: Element | null; focus: Element | null };
};

/** Note the terminal's element and what has focus, to compare later. */
function mark(page: Page) {
  return page.evaluate(() => {
    (window as Marked).kept = {
      grid: document.querySelector('[data-terminal-grid]'),
      focus: document.activeElement,
    };
  });
}

/** Whether the noted terminal element is still the one on screen, and
 *  the noted element still has focus. */
function kept(page: Page) {
  return page.evaluate(() => {
    const was = (window as Marked).kept;
    const grid = document.querySelector('[data-terminal-grid]');
    return {
      grid: !!was?.grid && was.grid === grid && grid.isConnected,
      focus: !!was?.focus && was.focus === document.activeElement,
    };
  });
}

test('a pane keeps its terminal mounted, with focus, as it is split off and collapses back', async ({
  desktop,
}) => {
  const { app, page, repoPath } = desktop;
  await createWorktree(page, 'alpha');
  await openNewTerminalDialog(app, page);
  await confirmNewTerminal(page, 'Shell');
  await expect(
    page.locator('[data-terminal-pane] .xterm-rows').getByText(/\S/).first()
  ).toBeVisible({ timeout: 15_000 });
  await focusTerminal(page);
  await page.keyboard.type('echo kept-$((40+2))\n', { delay: 20 });
  await expect(visibleText(page, 'kept-42')).toBeVisible({ timeout: 15_000 });
  await mark(page);
  expect(await kept(page)).toEqual({ grid: true, focus: true });

  // The first split: alpha goes right from its tab's menu, on its row
  // in the repository chip's roster, and the terminal's pane, the sole
  // one until now, becomes the left half.
  await openRoster(page, page.locator('[data-group-chip^="place:"]'));
  await armContextMenuChoice(app, 'Split right');
  await page
    .locator('[data-group-roster]')
    .getByRole('button', { name: /alpha/ })
    .click({ button: 'right' });
  await expect(panes(page)).toHaveCount(2);
  await expect.poll(async () => (await kept(page)).grid).toBe(true);
  await expect(visibleText(page, 'kept-42')).toBeVisible();
  // The new pane took focus, as a split does. Back in the terminal, the
  // element focused is the one noted: nothing was rebuilt.
  await focusTerminal(page);
  expect(await kept(page)).toEqual({ grid: true, focus: true });

  // The collapse: alpha's worktree goes away outside n10, its tab with
  // it, and the split gives way to the terminal's pane. Nothing is
  // pressed, so focus has no reason to move.
  execFileSync(
    'git',
    [
      'worktree',
      'remove',
      '--force',
      join(repoPath, '.claude', 'worktrees', 'alpha'),
    ],
    { cwd: repoPath, stdio: 'ignore' }
  );
  await expect(panes(page)).toHaveCount(1, { timeout: 20_000 });
  expect(await kept(page)).toEqual({ grid: true, focus: true });
  await expect(visibleText(page, 'kept-42')).toBeVisible();
});
