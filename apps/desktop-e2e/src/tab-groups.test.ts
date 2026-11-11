import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, focusTerminal, tab, tabs } from './setup/app.js';
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

/** Press `from`, carry it in pointer steps to `x, y`, and let go. */
async function drag(page: Page, from: Locator, x: number, y: number) {
  const a = await from.boundingBox();
  if (!a) throw new Error('not laid out');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 15 });
  await page.mouse.up();
}

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
    // A parent's group starts collapsed: its players wait behind the
    // chip, and expand into ordinary tabs right behind it.
    const members = group(page, CLAUDE).getByRole('tab');
    await expect(members).toHaveCount(1);
    await expect(tab(page, new RegExp(first))).toHaveCount(0);
    await chipOf(page, CLAUDE).locator('[data-group-disclosure]').click();
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
    await expect(roster(page)).toContainText('Codex');
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

    // The chip's one icon is the disclosure: a closed folder while its
    // players wait behind it, open once they show.
    const disclosure = chipOf(page, CLAUDE).locator('[data-group-disclosure]');
    await expect(disclosure).toHaveAccessibleName(/^Expand /);
    await expect(disclosure.locator('svg.lucide-folder-closed')).toBeVisible();
    await disclosure.click();
    await expect(disclosure).toHaveAccessibleName(/^Collapse /);
    await expect(disclosure.locator('svg.lucide-folder-open')).toBeVisible();

    // Collapsing keeps what is on screen, the count and the home.
    await tab(page, new RegExp(first)).click();
    await expect(shownTerminal(page)).toContainText(ready(first));
    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(disclosure).toHaveAccessibleName(/^Expand /);
    await expect(disclosure.locator('svg.lucide-folder-closed')).toBeVisible();
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

  test('a chip carries its whole group, and drops where the strip opened room', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const first = spawnAgent(repoPath, homeDir);
    branches.push(first);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });
    await chipOf(page, CLAUDE).locator('[data-group-disclosure]').click();
    await expect(tab(page, new RegExp(first))).toBeVisible();
    const home = chipOf(page, CLAUDE).getByRole('tab');
    const alpha = tab(page, /alpha/);
    // By the home's mark and each tab's whole label: a shown label is
    // cut to fit, and how far depends on the font.
    const order = async () => {
      const shown = await tabs(page).evaluateAll((els) =>
        els.map((el) => ({
          home: el.hasAttribute('data-home-tab'),
          label:
            el.querySelector('[data-tab-label] > :not([aria-hidden])')
              ?.textContent ?? '',
        }))
      );
      return {
        alpha: shown.findIndex((t) => !t.home && t.label.includes('alpha')),
        home: shown.findIndex((t) => t.home),
        player: shown.findIndex((t) => !t.home && t.label.includes(first)),
      };
    };
    await expect.poll(order).toMatchObject({ alpha: 0 });

    // The chip, dropped on alpha's near half, takes the group in front.
    const target = await alpha.boundingBox();
    await drag(page, home, target!.x + 8, target!.y + target!.height / 2);
    await expect.poll(order).toEqual({ home: 0, player: 1, alpha: 2 });

    // Carried into the room after the last tab, it goes to the end.
    const strip = await page
      .getByRole('tablist', { name: 'Open tabs' })
      .boundingBox();
    await drag(page, home, strip!.x + strip!.width - 20, strip!.y + 18);
    await expect.poll(order).toEqual({ home: 1, player: 2, alpha: 0 });
  });

  test('a member carried out of its group is told it stays there', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const first = spawnAgent(repoPath, homeDir);
    const second = spawnAgent(repoPath, homeDir);
    branches.push(first, second);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('3', { timeout: 30_000 });
    await chipOf(page, CLAUDE).locator('[data-group-disclosure]').click();
    const player = tab(page, new RegExp(first));
    await expect(player).toBeVisible();
    const from = await player.boundingBox();
    // Down off the strip, out of the group's box.
    await page.mouse.move(
      from!.x + from!.width / 2,
      from!.y + from!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + 160, {
      steps: 15,
    });
    await expect(page.locator('[data-group-drag-hint]')).toHaveText(
      'Tabs stay in their group'
    );
    await page.mouse.up();
    await expect(page.locator('[data-group-drag-hint]')).toHaveCount(0);
    await expect(group(page, CLAUDE).getByRole('tab')).toHaveCount(3);
    await expect(group(page, CLAUDE)).toContainText(first);
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

  test('opens the group a shown tab joins once its parent is known', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    // Alpha is the active tab while the group forms behind its chip.
    await createWorktree(page, 'alpha');
    branches.push(spawnAgent(repoPath, homeDir));
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });
    const disclosure = chipOf(page, CLAUDE).locator('[data-group-disclosure]');
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    const dir = mkdtempSync(join(tmpdir(), 'n10-late-'));
    startSurvivingTerminal({
      name: 'late-player',
      kind: 'dir',
      cwd: dir,
      command: 'sleep 300',
      homeDir,
    });
    const late = tab(page, new RegExp(basename(dir)));
    await late.click({ timeout: 30_000 });
    await expect(late).toHaveAttribute('aria-selected', 'true');
    // Tagged after it is shown: it joins the collapsed group, which opens.
    tagTmuxSession(
      'late-player',
      orchestraTags({ orchestrator: CLAUDE }),
      homeDir
    );
    await expect(countOf(page, CLAUDE)).toHaveText('3', { timeout: 30_000 });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(late).toHaveAttribute('aria-selected', 'true');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a press does not open the roster later, and Escape leaves the terminal its focus', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    branches.push(spawnAgent(repoPath, homeDir));
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });
    const home = chipOf(page, CLAUDE).getByRole('tab');
    const button = chipOf(page, CLAUDE).locator('[data-group-roster-button]');

    await page.clock.install();
    await home.click();
    await page.clock.runFor(450);
    await expect(roster(page)).toHaveCount(0);
    await page.clock.resume();
    await expect(shownTerminal(page)).toContainText(CONDUCTOR_READY);

    await focusTerminal(page);
    await page.mouse.move(0, 600);
    await page.clock.install();
    await button.hover();
    await page.clock.runFor(450);
    await expect(roster(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(roster(page)).toHaveCount(0);
    await page.clock.resume();
    await expect(button).not.toBeFocused();
    await expect(page.locator('.xterm-helper-textarea:focus')).toHaveCount(1);
  });

  test('pressing another group’s chip closes a roster pinned open', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    branches.push(
      spawnAgent(repoPath, homeDir),
      spawnAgent(repoPath, homeDir, CODEX)
    );
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });
    await expect(countOf(page, CODEX)).toHaveText('1', { timeout: 30_000 });

    await chipOf(page, CLAUDE).locator('[data-group-roster-button]').click();
    await expect(roster(page)).toHaveCount(1);
    await chipOf(page, CODEX).locator('[data-group-label]').click();
    await expect(roster(page)).toHaveCount(1);
    await expect(roster(page)).toHaveAttribute('aria-label', /Codex/);
  });
});
