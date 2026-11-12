import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, openRoster, tab } from './setup/app.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueExternalBranch,
} from './setup/external.js';

/**
 * Where focus goes when a worktree tab appears: to it when the user
 * created it, and nowhere when it was created outside the app — a
 * shell's `git worktree add` plus a tmux session, the way an
 * orchestrator spawns a player. The outside one opens behind the
 * active tab, marked unseen until it is first opened.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const chip = (page: Page) => page.locator('[data-group-chip^="place:"]');
const activeLabel = (page: Page) =>
  chip(page).locator('[data-group-active-label]');
/** A row of the chip's roster, once it is open. */
const row = (page: Page, name: RegExp) =>
  page.locator('[data-group-roster]').getByRole('button', { name });

test.describe('Tabs for work created outside the app', () => {
  let branches: string[] = [];

  test.beforeEach(() => {
    branches = [];
  });

  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, branches, desktop.homeDir);
  });

  test('a worktree created through the UI opens and focuses its tab', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'alpha');
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');

    // With another tab in front, the new one still takes focus; the two
    // now share their repository's chip, which names it.
    await createWorktree(page, 'beta');
    await expect(activeLabel(page)).toHaveText(/beta/);
    await expect(chip(page)).toHaveAttribute('aria-selected', 'true');
    await openRoster(page, chip(page));
    await expect(row(page, /beta/)).toHaveAttribute('aria-current', 'true');
    await expect(row(page, /beta/)).not.toHaveAccessibleName(/Not yet opened/);
    await expect(row(page, /alpha/)).not.toHaveAttribute('aria-current');
  });

  test('a worktree and session created from a shell open in the background', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');

    const branch = uniqueExternalBranch();
    branches.push(branch);
    const worktreePath = addExternalWorktree(repoPath, branch);
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath,
      command: 'sleep 120',
    });

    // It joins alpha behind the repository's chip, unseen, and alpha
    // stays in front.
    await expect(chip(page).locator('[data-group-count]')).toHaveText('2', {
      timeout: 30_000,
    });
    await expect(activeLabel(page)).toHaveText(/alpha/);
    await openRoster(page, chip(page));
    const background = row(page, new RegExp(branch));
    await expect(background).toHaveAccessibleName(/Not yet opened/);
    await expect(background).not.toHaveAttribute('aria-current');

    await background.click();
    await expect(activeLabel(page)).toHaveText(new RegExp(branch));
    await openRoster(page, chip(page));
    await expect(background).toHaveAttribute('aria-current', 'true');
    await expect(background).not.toHaveAccessibleName(/Not yet opened/);
  });
});
