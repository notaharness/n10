import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, tab } from './setup/app.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueExternalBranch,
} from './setup/external.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import { shownTerminal } from './setup/prewarm.js';
import { orchestraTags } from '@n10/core/testing/session-tags';
import { startSurvivingTerminal } from './setup/terminals.js';
import { killFixtureSessions, tagTmuxSession } from './setup/tmux.js';

/**
 * The strip groups its tabs by what they belong to: Orchestra players
 * under the parent they report to (`@session-x-orchestra-orchestrator`),
 * headed by the parent's own tab when it has one here (the session
 * carrying `@session-x-orchestra-target`), else by a stand-in chip;
 * everything else by its repository or directory. Plain tmux tags on
 * the test's own server.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const CLAUDE = 'claude:7c0ffee0-1234-4abc-8def-0123456789ab';
const CODEX = 'codex:01a10ed5-da8b-7120-bf36-8325cc735440';
const ORCHESTRATOR = 'conductor-shell';
const CONDUCTOR_READY = 'conductor-ready';

const group = (page: Page, key: string | RegExp) =>
  page.locator('[data-tab-group]').filter({
    has: page.locator(
      typeof key === 'string'
        ? `[data-group-chip="${key}"]`
        : '[data-group-chip]',
      typeof key === 'string' ? {} : { hasText: key }
    ),
  });
const chipOf = (page: Page, key: string) =>
  page.locator(`[data-group-chip="${key}"]`);
const countOf = (page: Page, key: string) =>
  chipOf(page, key).locator('[data-group-count]');
const roster = (page: Page) => page.locator('[data-group-roster]');
const rosterRows = (page: Page) => roster(page).locator('[data-roster-row]');
const ready = (branch: string) => `player-${branch}-ready`;

test.describe('Tab groups', () => {
  let folder = '';
  let branches: string[] = [];
  const others: { repo: string; branches: string[] }[] = [];

  test.beforeEach(({ desktop }) => {
    folder = mkdtempSync(join(tmpdir(), 'n10-conductor-'));
    branches = [];
    startSurvivingTerminal({
      name: ORCHESTRATOR,
      cwd: folder,
      command: `printf '%s\\n' ${CONDUCTOR_READY}; sleep 300`,
      homeDir: desktop.homeDir,
    });
  });

  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, branches, desktop.homeDir);
    for (const other of others.splice(0)) {
      cleanupExternalSessions(other.repo, other.branches, desktop.homeDir);
      cleanupTestRepo(other.repo);
    }
    killFixtureSessions(desktop.homeDir);
    rmSync(folder, { recursive: true, force: true });
  });

  /** A worktree session made outside the app in `repoPath`, reporting
   *  to `target` (none: a plain agent). It prints its name once. */
  function spawnAgent(
    repoPath: string,
    homeDir: string,
    target: string | null = CLAUDE
  ): string {
    const branch = uniqueExternalBranch();
    const name = startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath: addExternalWorktree(repoPath, branch),
      command: `printf '%s\\n' ${ready(branch)}; sleep 300`,
    });
    if (target)
      tagTmuxSession(name, orchestraTags({ orchestrator: target }), homeDir);
    return branch;
  }

  function markOrchestrator(homeDir: string, target = CLAUDE): void {
    tagTmuxSession(ORCHESTRATOR, orchestraTags({ target }), homeDir);
  }

  test('heads its players’ group with the orchestrator’s own tab, counted with them', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const first = spawnAgent(repoPath, homeDir);
    const second = spawnAgent(repoPath, homeDir);
    branches.push(first, second);
    markOrchestrator(homeDir);

    await expect(countOf(page, CLAUDE)).toHaveText('3', { timeout: 30_000 });
    const home = chipOf(page, CLAUDE).getByRole('tab');
    await expect(home).toHaveText(new RegExp(basename(folder)));
    // Players are ordinary visible tabs, right behind their chip.
    const members = group(page, CLAUDE).getByRole('tab');
    await expect(members).toHaveCount(3);
    await expect(tab(page, new RegExp(first))).toBeVisible();
    await expect(tab(page, new RegExp(second))).toBeVisible();

    // The roster lists the home first, then the members; a row shows it.
    await chipOf(page, CLAUDE).locator('[data-group-roster-button]').click();
    await expect(rosterRows(page)).toHaveCount(3);
    await expect(rosterRows(page).first()).toContainText(basename(folder));
    await rosterRows(page).filter({ hasText: second }).click();
    await expect(roster(page)).toHaveCount(0);
    await expect(tab(page, new RegExp(second))).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(shownTerminal(page)).toContainText(ready(second));

    // The home's label shows the home, not the roster.
    await home.click();
    await expect(home).toHaveAttribute('aria-selected', 'true');
    await expect(shownTerminal(page)).toContainText(CONDUCTOR_READY);
    await expect(roster(page)).toHaveCount(0);
  });

  test('stands in for a parent with no tab here, across repositories and directories', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    const other = createTestRepo({ name: 'transloco' });
    const elsewhere = spawnAgent(
      other,
      homeDir,
      `beam:${'a'.repeat(32)}/${CODEX}`
    );
    others.push({ repo: other, branches: [elsewhere] });
    const dir = mkdtempSync(join(tmpdir(), 'n10-dir-player-'));
    startSurvivingTerminal({
      name: 'transloco-dir',
      kind: 'dir',
      cwd: dir,
      command: 'sleep 300',
      homeDir,
    });
    tagTmuxSession(
      'transloco-dir',
      orchestraTags({ orchestrator: CODEX }),
      homeDir
    );

    await expect(countOf(page, CODEX)).toHaveText('2', { timeout: 30_000 });
    // No tab of its own: a label that opens the roster.
    const standIn = chipOf(page, CODEX).locator('[data-group-label]');
    await expect(standIn).toHaveText('Codex');
    await expect(chipOf(page, CODEX).getByRole('tab')).toHaveCount(0);
    await standIn.click();
    await expect(roster(page)).toContainText('Parent not open here');
    await expect(rosterRows(page)).toHaveCount(2);
    rmSync(dir, { recursive: true, force: true });
  });

  test('groups other tabs by repository, and gives a lone directory tab no chip', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const a = spawnAgent(repoPath, homeDir, null);
    const b = spawnAgent(repoPath, homeDir, null);
    branches.push(a, b);

    await expect(tab(page, new RegExp(a))).toBeVisible({ timeout: 30_000 });
    await expect(tab(page, new RegExp(b))).toBeVisible({ timeout: 30_000 });
    const place = page.locator('[data-group-chip^="place:"]').filter({
      has: page.locator('[data-group-label]', { hasText: basename(repoPath) }),
    });
    await expect(place.locator('[data-group-count]')).toHaveText('2');
    // The conductor shell, alone in its folder: an ordinary tab.
    const lone = tab(page, new RegExp(basename(folder)));
    await expect(lone).toBeVisible();
    await expect(
      page.locator('[data-tab-group]').filter({ has: lone })
    ).toHaveCount(0);
  });

  test('collapses to its chip, and opens again for a tab activated in it', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const first = spawnAgent(repoPath, homeDir);
    const second = spawnAgent(repoPath, homeDir);
    branches.push(first, second);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('3', { timeout: 30_000 });

    // Collapsing keeps what is on screen, the count and the home.
    await tab(page, new RegExp(first)).click();
    await expect(shownTerminal(page)).toContainText(ready(first));
    const disclosure = chipOf(page, CLAUDE).locator('[data-group-disclosure]');
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(tab(page, new RegExp(first))).toHaveCount(0);
    await expect(tab(page, new RegExp(second))).toHaveCount(0);
    await expect(countOf(page, CLAUDE)).toHaveText('3');
    await expect(shownTerminal(page)).toContainText(ready(first));

    // Switching by keyboard walks into the collapsed group, which opens:
    // back from alpha, the strip's first tab, to the group's last.
    await tab(page, /alpha/).click();
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Control+PageUp');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(
      group(page, CLAUDE).getByRole('tab', { selected: true })
    ).toHaveCount(1);
  });

  test('opens the roster on a rest, not on focus', async ({ desktop }) => {
    const { page, repoPath, homeDir } = desktop;
    branches.push(spawnAgent(repoPath, homeDir));
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });

    await page.clock.install();
    await chipOf(page, CLAUDE).locator('[data-group-roster-button]').hover();
    await page.clock.runFor(450);
    await expect(roster(page)).toBeVisible();
    // Hover-open takes no focus; leaving closes it.
    await expect(rosterRows(page).first()).not.toBeFocused();
    await page.mouse.move(0, 600);
    await page.clock.runFor(250);
    await expect(roster(page)).toHaveCount(0);

    await chipOf(page, CLAUDE).getByRole('tab').focus();
    await page.clock.runFor(450);
    await expect(roster(page)).toHaveCount(0);
    await page.clock.resume();
    // Alt+ArrowDown opens it from the keyboard, on the active tab's row.
    await page.keyboard.press('Alt+ArrowDown');
    await expect(roster(page)).toBeVisible();
    await expect(
      roster(page).locator('[data-roster-row][aria-current=true]')
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(roster(page)).toHaveCount(0);
  });
});
