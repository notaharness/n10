import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { orchestraTags } from '@n10/core/testing/session-tags';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, focusTerminal, tab } from './setup/app.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueExternalBranch,
} from './setup/external.js';
import { armContextMenuChoice } from './setup/menu.js';
import { startSurvivingTerminal } from './setup/terminals.js';
import { killFixtureSessions, tagTmuxSession } from './setup/tmux.js';

/**
 * The supervising layouts over an Orchestra group: Tile group puts the
 * orchestrator's players in a pane beside it; Follow group gives them a
 * pane that shows whichever last had new output, without taking focus,
 * pausing while the user is in it. Plain tmux sessions on the test's own
 * server: an orchestrator shell marked as the parent's home, and players
 * reporting to it, each streaming output whenever the test asks.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const CLAUDE = 'claude:5afe7e11-0000-4abc-8def-0123456789ab';
const ORCHESTRATOR = 'supervisor-shell';

const panes = (page: Page) => page.locator('[data-pane-id]');
const paneWith = (page: Page, branch: string) =>
  page.locator('[data-pane-id]', { has: tab(page, new RegExp(branch)) });
const chip = (page: Page) =>
  page.locator(`[data-group-chip="${CLAUDE}"]`).first();
const followLine = (page: Page) => page.locator('[data-follow-line]');

test.describe('Supervising layouts', () => {
  let folder = '';
  let branches: string[] = [];

  test.beforeEach(({ desktop }) => {
    folder = mkdtempSync(join(tmpdir(), 'n10-supervisor-'));
    branches = [];
    startSurvivingTerminal({
      name: ORCHESTRATOR,
      cwd: folder,
      command: `printf '%s\\n' supervisor-ready; sleep 600`,
      homeDir: desktop.homeDir,
    });
  });

  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, branches, desktop.homeDir);
    killFixtureSessions(desktop.homeDir);
    rmSync(folder, { recursive: true, force: true });
  });

  /** A player reporting to the orchestrator. Each time `go` (below) is
   *  called for it, it streams output for seven seconds — a work streak
   *  past the activity rule's minimum — and goes quiet. */
  function spawnPlayer(repoPath: string, homeDir: string): string {
    const branch = uniqueExternalBranch();
    const flag = join(folder, `go-${branch}`);
    const name = startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath: addExternalWorktree(repoPath, branch),
      command:
        `printf '%s\\n' ${branch}-ready; ` +
        `while :; do while [ ! -f ${flag} ]; do sleep 0.2; done; rm -f ${flag}; ` +
        `i=0; while [ $i -lt 70 ]; do echo ${branch}-working-$i; i=$((i+1)); sleep 0.1; done; done`,
    });
    tagTmuxSession(name, orchestraTags({ orchestrator: CLAUDE }), homeDir);
    branches.push(branch);
    return branch;
  }
  const go = (branch: string) =>
    writeFileSync(join(folder, `go-${branch}`), '');

  function markOrchestrator(homeDir: string): void {
    tagTmuxSession(ORCHESTRATOR, orchestraTags({ target: CLAUDE }), homeDir);
  }

  test('tiles a group: the home stays, its players move into a pane beside it', async ({
    desktop,
  }) => {
    const { page, app, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const first = spawnPlayer(repoPath, homeDir);
    const second = spawnPlayer(repoPath, homeDir);
    markOrchestrator(homeDir);
    await expect(chip(page).locator('[data-group-count]')).toHaveText('3', {
      timeout: 30_000,
    });

    await armContextMenuChoice(app, 'Tile group');
    await chip(page).getByRole('tab').click({ button: 'right' });

    await expect(panes(page)).toHaveCount(2);
    const home = panes(page).nth(0);
    const players = panes(page).nth(1);
    await expect(home.getByRole('tab', { selected: true })).toHaveText(
      new RegExp(basename(folder))
    );
    await expect(tab(page, /alpha/)).toHaveCount(1);
    await expect(home.getByRole('tab', { name: /alpha/ })).toHaveCount(1);
    await expect(
      players.getByRole('tab', { name: new RegExp(first) })
    ).toBeVisible();
    await expect(
      players.getByRole('tab', { name: new RegExp(second) })
    ).toBeVisible();
    // The source keeps focus, for supervision.
    await expect(home).toHaveAttribute('data-pane-focused', 'true');
  });

  test('follows a group: switches on new output without taking focus, pauses while the user is in it, and stops', async ({
    desktop,
  }) => {
    const { page, app, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const players = [
      spawnPlayer(repoPath, homeDir),
      spawnPlayer(repoPath, homeDir),
    ];
    markOrchestrator(homeDir);
    await expect(chip(page).locator('[data-group-count]')).toHaveText('3', {
      timeout: 30_000,
    });
    // The orchestrator's own terminal is shown, and typed in.
    const home = chip(page).getByRole('tab');
    await home.click();
    await expect(home).toHaveAttribute('aria-selected', 'true');
    await focusTerminal(page);
    // A menu is opened with a press, which focuses the tab pressed.
    const pressed = await home.elementHandle();
    const terminal = await page.evaluateHandle(
      () =>
        document.querySelector(
          '[data-editor-panes] > :not([data-spare-pane]) .xterm'
        )!
    );

    await armContextMenuChoice(app, 'Follow group');
    await home.click({ button: 'right' });

    // The players go to a follow pane. The orchestrator's terminal stays
    // where it was, the same element.
    await expect(panes(page)).toHaveCount(2);
    const source = panes(page).nth(0);
    const follow = panes(page).nth(1);
    await expect(followLine(page)).toHaveText(/^Following /);
    await expect(follow.locator('[data-follow-line]')).toHaveCount(1);
    await expect(follow.getByRole('tab')).toHaveCount(2);
    await expect(source).toHaveAttribute('data-pane-focused', 'true');
    await expect(home).toHaveAttribute('aria-selected', 'true');
    // Focus is where the menu left it, on the same tab element: the
    // source was not mounted again.
    expect(
      await page.evaluate(
        ([t, x]) =>
          document.activeElement === t &&
          x.isConnected &&
          !!x.closest('[data-pane-focused]'),
        [pressed, terminal] as const
      )
    ).toBe(true);
    const shownIn = (branch: string) =>
      follow.getByRole('tab', { name: new RegExp(branch) });
    // It starts on the first in strip order; the other is `second`.
    const selected = await follow
      .getByRole('tab', { selected: true })
      .innerText();
    const first = players.find((b) => selected.includes(b))!;
    const second = players.find((b) => b !== first)!;
    expect(first).toBeDefined();

    // The other player's new output takes the follow pane; focus stays.
    go(second);
    await expect(shownIn(second)).toHaveAttribute('aria-selected', 'true', {
      timeout: 30_000,
    });
    await expect(source).toHaveAttribute('data-pane-focused', 'true');
    expect(
      await follow.evaluate((el) => el.contains(document.activeElement))
    ).toBe(false);

    // In the pane, the user's choice stays put while new output arrives.
    await shownIn(first).click();
    await expect(follow).toHaveAttribute('data-pane-focused', 'true');
    await expect(followLine(page)).toHaveText(/^Following paused · /);
    // What it showed before is seen; only new output counts.
    await expect(shownIn(second)).not.toHaveClass(/tab-attention/);
    go(second);
    await expect(shownIn(second)).toHaveClass(/tab-attention/, {
      timeout: 30_000,
    });
    // Asserting that nothing switches needs a window: well past the
    // 250 ms a switch would wait for.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- a negative check has no event to wait on
    await page.waitForTimeout(1_500);
    await expect(shownIn(first)).toHaveAttribute('aria-selected', 'true');

    // Leaving the pane resumes: the waiting output is shown.
    await tab(page, /alpha/).click();
    await expect(source).toHaveAttribute('data-pane-focused', 'true');
    await expect(followLine(page)).toHaveText(/^Following (?!paused)/);
    await expect(shownIn(second)).toHaveAttribute('aria-selected', 'true', {
      timeout: 10_000,
    });

    // Stop following: the line goes, the pane and its tabs stay.
    await follow.getByRole('button', { name: 'Stop following' }).click();
    await expect(followLine(page)).toHaveCount(0);
    await expect(page.getByText(/^Stopped following /)).toBeVisible();
    await expect(panes(page)).toHaveCount(2);
    await expect(follow.getByRole('tab')).toHaveCount(2);
    await expect(paneWith(page, second)).toHaveCount(1);
  });
});
