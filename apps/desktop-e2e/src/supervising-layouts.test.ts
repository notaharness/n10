import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
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
const chipIn = (scope: Page | Locator) =>
  scope.locator(`[data-group-chip="${CLAUDE}"]`);
const chip = (page: Page) => chipIn(page).first();
const countIn = (scope: Page | Locator) =>
  chipIn(scope).locator('[data-group-count]');
/** Choose `name`'s row in the roster of the group's chip in `scope`. */
async function choose(page: Page, scope: Page | Locator, name: RegExp) {
  await chipIn(scope).first().click();
  const roster = page.locator('[data-group-roster]');
  await roster.getByRole('button', { name }).click();
  await expect(roster).toHaveCount(0);
}
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
    await chip(page).click({ button: 'right' });

    // Each pane shows the group as its own chip: the home in the source,
    // the players beside it.
    await expect(panes(page)).toHaveCount(2);
    const home = panes(page).nth(0);
    const players = panes(page).nth(1);
    await expect(countIn(home)).toHaveText('1');
    await expect(chipIn(home)).toHaveAttribute('aria-selected', 'true');
    await expect(chipIn(home)).toHaveAttribute('data-home-tab', /.+/);
    await expect(tab(page, /alpha/)).toHaveCount(1);
    await expect(home.getByRole('tab', { name: /alpha/ })).toHaveCount(1);
    await expect(countIn(players)).toHaveText('2');
    await expect(chipIn(players)).toHaveAttribute('aria-selected', 'true');
    await expect(
      chipIn(players).locator('[data-group-active-label]')
    ).toHaveText(new RegExp(`${first}|${second}`));
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
    const home = chip(page);
    await choose(page, page, /^Orchestrator/);
    await expect(home).toHaveAttribute('aria-selected', 'true');
    await armContextMenuChoice(app, 'Rename group…');
    await home.click({ button: 'right' });
    const rename = page.getByRole('dialog', { name: 'Rename group' });
    await rename.getByRole('textbox', { name: 'Name' }).fill('Release crew');
    await rename.getByRole('button', { name: 'Save' }).click();
    await expect(chip(page)).toContainText('Release crew');
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
    await expect(followLine(page)).toContainText('Following Release crew');
    await expect(follow.locator('[data-follow-line]')).toHaveCount(1);
    await expect(countIn(follow)).toHaveText('2');
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
    // The follow pane's chip names the member it shows.
    const shownIn = (branch: string) =>
      chipIn(follow).locator('[data-group-active-label]', {
        hasText: branch,
      });
    // It starts on the first in strip order; the other is `second`.
    const selected = await chipIn(follow)
      .locator('[data-group-active-label]')
      .innerText();
    const first = players.find((b) => selected.includes(b))!;
    const second = players.find((b) => b !== first)!;
    expect(first).toBeDefined();

    // The other player's new output takes the follow pane; focus stays.
    go(second);
    await expect(shownIn(second)).toHaveCount(1, { timeout: 30_000 });
    await expect(source).toHaveAttribute('data-pane-focused', 'true');
    expect(
      await follow.evaluate((el) => el.contains(document.activeElement))
    ).toBe(false);

    // In the pane, the user's choice stays put while new output arrives.
    await choose(page, follow, new RegExp(first));
    await expect(follow).toHaveAttribute('data-pane-focused', 'true');
    await expect(followLine(page)).toHaveText(/^Following paused · /);
    // What it showed before is seen; only new output counts.
    const newOutput = chipIn(follow).locator('[data-status="new-output"]');
    await expect(newOutput).toHaveCount(0);
    go(second);
    await expect(newOutput).toHaveCount(1, { timeout: 30_000 });
    // Asserting that nothing switches needs a window: well past the
    // 250 ms a switch would wait for.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- a negative check has no event to wait on
    await page.waitForTimeout(1_500);
    await expect(shownIn(first)).toHaveCount(1);

    // Leaving the pane resumes: the waiting output is shown.
    await tab(page, /alpha/).click();
    await expect(source).toHaveAttribute('data-pane-focused', 'true');
    await expect(followLine(page)).toHaveText(/^Following (?!paused)/);
    await expect(shownIn(second)).toHaveCount(1, { timeout: 10_000 });

    // Stop following: the line goes, the pane and its tabs stay.
    await follow.getByRole('button', { name: 'Stop following' }).click();
    await expect(followLine(page)).toHaveCount(0);
    await expect(page.getByText(/^Stopped following /)).toBeVisible();
    await expect(panes(page)).toHaveCount(2);
    await expect(countIn(follow)).toHaveText('2');
  });
});
