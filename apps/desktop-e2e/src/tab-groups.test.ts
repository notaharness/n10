import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  focusTerminal,
  openAllTabs,
  openRoster,
  stripTab,
  tab,
} from './setup/app.js';
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
import { armContextMenuChoice } from './setup/menu.js';
import { startSurvivingTerminal } from './setup/terminals.js';
import {
  findN10SessionFor,
  killFixtureSessions,
  setTmuxPaneTitle,
  tagTmuxSession,
} from './setup/tmux.js';

/**
 * The strip groups its tabs by what they belong to: Orchestra players
 * under the parent they report to (`@session-x-orchestra-orchestrator`),
 * headed by the parent's own session when it has one here (the session
 * carrying `@session-x-orchestra-target`); everything else by its
 * repository or directory. Each group is one chip on the strip whose
 * roster lists its tabs; none expands into the row. Plain tmux tags on
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
const activeLabel = (page: Page, key: string) =>
  chipOf(page, key).locator('[data-group-active-label]');
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
    // A generic title keeps the branch fallback independent of tmux's process title.
    setTmuxPaneTitle(name, 'Codex', homeDir);
    if (target)
      tagTmuxSession(name, orchestraTags({ orchestrator: target }), homeDir);
    return branch;
  }

  function markOrchestrator(homeDir: string, target = CLAUDE): void {
    tagTmuxSession(ORCHESTRATOR, orchestraTags({ target }), homeDir);
  }

  test('stands for its players and their home in one chip, counted with them', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const first = spawnAgent(repoPath, homeDir);
    const second = spawnAgent(repoPath, homeDir);
    branches.push(first, second);
    markOrchestrator(homeDir);

    await expect(countOf(page, CLAUDE)).toHaveText('3', { timeout: 30_000 });
    const chip = chipOf(page, CLAUDE);
    await expect(chip).toHaveAttribute('role', 'tab');
    await expect(chip).toHaveAttribute('data-home-tab', /.+/);
    await expect(chip.locator('[data-group-label]')).toHaveText(
      `Claude · ${basename(folder)}`
    );
    // Nothing of the group is on the strip but its chip.
    await expect(group(page, CLAUDE).getByRole('tab')).toHaveCount(1);
    await expect(stripTab(page, new RegExp(first))).toHaveCount(0);
    await expect(stripTab(page, new RegExp(second))).toHaveCount(0);

    // All tabs still lists every tab; choosing a member marks the chip.
    await page.getByRole('button', { name: 'All tabs' }).click();
    const all = page.getByRole('dialog', { name: 'All tabs' });
    await expect(all.locator('[data-roster-row]')).toHaveCount(4);
    await all.getByRole('button', { name: new RegExp(second) }).click();
    await expect(chip).toHaveAttribute('aria-selected', 'true');
    await expect(activeLabel(page, CLAUDE)).toContainText(second);
    await expect(shownTerminal(page)).toContainText(ready(second));
    await expect(stripTab(page, new RegExp(second))).toHaveCount(0);

    // An orchestrator's chip carries its brain. Its roster lists the
    // home first, then the players under it, the active one marked. A
    // row shows its tab, and the strip stays as it was.
    await expect(chip.locator('svg.lucide-brain')).toBeVisible();
    await openRoster(page, chip);
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(rosterRows(page)).toHaveCount(3);
    await expect(rosterRows(page).first()).toContainText('Orchestrator');
    await expect(rosterRows(page).first()).toContainText(basename(folder));
    await expect(rosterRows(page).first()).toHaveAttribute(
      'data-roster-depth',
      '0'
    );
    await expect(rosterRows(page).nth(1)).toHaveAttribute(
      'data-roster-depth',
      '1'
    );
    await expect(
      roster(page).locator('[data-roster-row][aria-current=true]')
    ).toContainText(second);
    await rosterRows(page).filter({ hasText: first }).click();
    await expect(roster(page)).toHaveCount(0);
    await expect(activeLabel(page, CLAUDE)).toContainText(first);
    await expect(shownTerminal(page)).toContainText(ready(first));
    await expect(group(page, CLAUDE).getByRole('tab')).toHaveCount(1);

    // Pressing the chip shows the group's first tab: its home.
    await chip.click();
    await expect(roster(page)).toHaveCount(0);
    await expect(shownTerminal(page)).toContainText(CONDUCTOR_READY);
    await expect(chip).toHaveAttribute('aria-selected', 'true');

    // Away from the group, the chip is plain again.
    await tab(page, /alpha/).click();
    await expect(chip).toHaveAttribute('aria-selected', 'false');
    await expect(activeLabel(page, CLAUDE)).toHaveCount(0);
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
    const chip = chipOf(page, CODEX);
    await expect(chip.locator('[data-group-label]')).toHaveText(
      'Codex · Multiple places'
    );
    await expect(chip).not.toHaveAttribute('data-home-tab');
    await expect(chip.locator('svg.lucide-folder-closed')).toBeVisible();
    await openRoster(page, chip);
    await expect(chip.locator('svg.lucide-folder-open')).toBeVisible();
    await expect(roster(page)).toContainText('Codex');
    await expect(rosterRows(page)).toHaveCount(2);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a group shown behind the one it follows is carried, not disabled', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    branches.push(spawnAgent(repoPath, homeDir));
    // The orchestrator reports to another, which has no tab here but
    // players of its own, so it has a chip to follow.
    branches.push(
      spawnAgent(repoPath, homeDir, CODEX),
      spawnAgent(repoPath, homeDir, CODEX)
    );
    tagTmuxSession(
      ORCHESTRATOR,
      orchestraTags({ target: CLAUDE, orchestrator: CODEX }),
      homeDir
    );
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });
    await expect(countOf(page, CODEX)).toHaveText('2', { timeout: 30_000 });
    // Shown behind the group it follows, which carries it.
    const xOf = (key: string) =>
      chipOf(page, key).evaluate((el) => el.getBoundingClientRect().x);
    await expect
      .poll(async () => (await xOf(CODEX)) < (await xOf(CLAUDE)))
      .toBe(true);
    const home = chipOf(page, CLAUDE);
    await expect(home).toHaveAttribute('aria-roledescription', /sortable/);
    await expect(home).not.toHaveAttribute('aria-disabled', 'true');
    await home.click();
    await expect(home).toHaveAttribute('aria-selected', 'true');
    await expect(shownTerminal(page)).toContainText(CONDUCTOR_READY);
  });

  test('groups other tabs by repository behind a chip, and gives a lone directory tab none', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const a = spawnAgent(repoPath, homeDir, null);
    const b = spawnAgent(repoPath, homeDir, null);
    branches.push(a, b);

    const place = page.locator('[data-group-chip^="place:"]').filter({
      has: page.locator('[data-group-label]', { hasText: basename(repoPath) }),
    });
    await expect(place.locator('[data-group-count]')).toHaveText('2', {
      timeout: 30_000,
    });
    await expect(stripTab(page, new RegExp(a))).toHaveCount(0);
    await openRoster(page, place);
    await expect(rosterRows(page).filter({ hasText: a })).toHaveCount(1);
    await expect(rosterRows(page).filter({ hasText: b })).toHaveCount(1);
    await page.keyboard.press('Escape');
    // The conductor shell, alone in its folder: an ordinary tab.
    const lone = tab(page, new RegExp(basename(folder)));
    await expect(lone).toBeVisible();
    await expect(
      page.locator('[data-tab-group]').filter({ has: lone })
    ).toHaveCount(0);
  });

  test('keeps a lone agent tab’s width as its task changes, and names tasks in the roster', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const first = spawnAgent(repoPath, homeDir, null);
    const second = spawnAgent(repoPath, homeDir, null);
    const other = createTestRepo({ name: 'labels' });
    const solo = spawnAgent(other, homeDir, null);
    branches.push(first, second);
    others.push({ repo: other, branches: [solo] });
    startSurvivingTerminal({
      name: 'repo-shell',
      cwd: repoPath,
      command: 'sleep 300',
      homeDir,
    });
    const place = page.locator(`[data-group-chip="place:${repoPath}"]`);
    await expect(place.locator('[data-group-count]')).toHaveText('3', {
      timeout: 30_000,
    });
    const lone = tab(page, new RegExp(basename(folder)));
    await expect(lone.locator('[data-tab-label]')).toContainText(
      basename(folder)
    );
    // A shell's label is as wide as its name, not a task's fixed width.
    const shellLabel = lone.locator('[data-tab-label]');
    expect(
      await shellLabel.evaluate((el) => el.getBoundingClientRect().width)
    ).toBeLessThan(176);
    await expect(shellLabel).not.toHaveClass(/w-36/);
    const soloTab = tab(page, new RegExp(solo));
    await expect(soloTab).toBeVisible({ timeout: 30_000 });
    const fallbackWidth = await soloTab.evaluate(
      (element) => element.getBoundingClientRect().width
    );
    const soloSession = findN10SessionFor(solo, homeDir) as string;
    setTmuxPaneTitle(soloSession, '⠋ Fix auth', homeDir);
    const task = tab(page, /Fix auth/);
    await expect(task).toBeVisible({ timeout: 30_000 });
    expect(
      await task.evaluate((element) => element.getBoundingClientRect().width)
    ).toBe(fallbackWidth);
    setTmuxPaneTitle(soloSession, 'Fix token refresh', homeDir);
    await expect(tab(page, /Fix token refresh/)).toBeVisible({
      timeout: 30_000,
    });
    expect(
      await tab(page, /Fix token refresh/).evaluate(
        (element) => element.getBoundingClientRect().width
      )
    ).toBe(fallbackWidth);

    // A member's task names its roster row, and the chip while shown.
    const session = findN10SessionFor(first, homeDir) as string;
    setTmuxPaneTitle(session, 'Probe scan', homeDir);
    // Opened from the keyboard, it stays open while the title is polled:
    // one a rest opened closes on any pointer leave, and parallel
    // workers' windows on one X display move the pointer.
    await place.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(roster(page)).toBeVisible();
    const row = rosterRows(page).filter({ hasText: 'Probe scan' });
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(
      rosterRows(page).filter({ hasText: basename(repoPath) })
    ).not.toHaveCount(0);
    await row.click();
    await expect(activeLabel(page, `place:${repoPath}`)).toContainText(
      'Probe scan'
    );
  });

  test('walks members by keyboard, marking their chip active and leaving the strip as it is', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    const first = spawnAgent(repoPath, homeDir);
    const second = spawnAgent(repoPath, homeDir);
    branches.push(first, second);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('3', { timeout: 30_000 });
    const chip = chipOf(page, CLAUDE);
    const blocks = page.locator('[role=tablist] > *');
    await tab(page, /alpha/).click();
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
    const before = await blocks.count();

    // Back from alpha, the strip's first tab, to the group's last
    // member, then the one before it.
    const member = new RegExp(`${first}|${second}`);
    await page.keyboard.press('Control+PageUp');
    await expect(chip).toHaveAttribute('aria-selected', 'true');
    await expect(activeLabel(page, CLAUDE)).toHaveText(member);
    const last = await activeLabel(page, CLAUDE).innerText();
    await page.keyboard.press('Control+PageUp');
    await expect(activeLabel(page, CLAUDE)).toHaveText(member);
    await expect(activeLabel(page, CLAUDE)).not.toHaveText(last);
    await expect(blocks).toHaveCount(before);
    await expect(group(page, CLAUDE).getByRole('tab')).toHaveCount(1);
    await page.keyboard.press('Control+PageDown');
    await page.keyboard.press('Control+PageDown');
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
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
    const chip = chipOf(page, CLAUDE);
    const alpha = tab(page, /alpha/);
    // By attribute, not by label: a label cut to fit may lose the text.
    const order = () =>
      page.evaluate(() => {
        const row = [
          ...document.querySelectorAll<HTMLElement>(
            '[role=tablist][aria-label="Open tabs"] [role=tab]'
          ),
        ];
        return {
          alpha: row.findIndex((t) => t.dataset.tabId?.includes('alpha')),
          home: row.findIndex((t) => t.dataset.homeTab !== undefined),
        };
      });
    // Opened after alpha, the orchestrator's group still leads: n10
    // puts orchestrators first until the strip is arranged by hand.
    await expect.poll(order).toEqual({ home: 0, alpha: 1 });

    // Carried into the room after the last tab, it goes to the end.
    const strip = await page
      .getByRole('tablist', { name: 'Open tabs' })
      .boundingBox();
    await drag(page, chip, strip!.x + strip!.width - 20, strip!.y + 18);
    await expect.poll(order).toEqual({ alpha: 0, home: 1 });
    // The drop's click shows no tab of the group.
    await expect(chip).toHaveAttribute('aria-selected', 'false');

    // The chip, dropped on alpha's near half, takes the group in front.
    const target = await alpha.boundingBox();
    await drag(page, chip, target!.x + 8, target!.y + target!.height / 2);
    await expect.poll(order).toEqual({ home: 0, alpha: 1 });
    // Its player went with it: every tab, in order, is home, player,
    // then alpha.
    const home = await chip.getAttribute('data-home-tab');
    const listed = (await openAllTabs(page)).locator('[data-roster-row]');
    await expect(listed).toHaveCount(3);
    const ids = await listed.evaluateAll((rows) =>
      rows.map((r) => r.getAttribute('data-roster-row') ?? '')
    );
    expect(ids[0]).toBe(home);
    expect(ids[1]).toContain(first);
    expect(ids[2]).toContain('alpha');
  });

  test('a roster row’s menu pins its tab onto the strip, out of the chip', async ({
    desktop,
  }) => {
    const { page, app, repoPath, homeDir } = desktop;
    const first = spawnAgent(repoPath, homeDir);
    const second = spawnAgent(repoPath, homeDir);
    branches.push(first, second);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('3', { timeout: 30_000 });

    const chip = chipOf(page, CLAUDE);
    await chip.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(roster(page)).toBeVisible();
    const row = rosterRows(page).filter({ hasText: first });
    await row.focus();
    await armContextMenuChoice(app, 'Pin tab');
    await row.click({ button: 'right' });
    const pinned = page.locator('[data-pinned]', { hasText: first });
    await expect(pinned).toBeVisible();
    await expect(countOf(page, CLAUDE)).toHaveText('2');
    await expect(stripTab(page, new RegExp(second))).toHaveCount(0);
    // Its row gone, focus goes to the row now in its place.
    await expect(roster(page)).toBeVisible();
    await expect(rosterRows(page).nth(1)).toContainText(second);
    await expect(rosterRows(page).nth(1)).toBeFocused();
  });

  test('opens the roster on a rest, not on focus, and from the keyboard', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const player = spawnAgent(repoPath, homeDir);
    branches.push(player);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });
    const chip = chipOf(page, CLAUDE);
    // The home shown, its row the current one.
    await chip.click();
    await expect(shownTerminal(page)).toContainText(CONDUCTOR_READY);
    await page.mouse.move(0, 600);

    await page.clock.install();
    await chip.hover();
    await page.clock.runFor(450);
    await expect(roster(page)).toBeVisible();
    // Hover-open takes no focus; leaving closes it.
    await expect(rosterRows(page).first()).not.toBeFocused();
    await page.mouse.move(0, 600);
    await page.clock.runFor(250);
    await expect(roster(page)).toHaveCount(0);

    await chip.focus();
    await page.clock.runFor(450);
    await expect(roster(page)).toHaveCount(0);
    await page.clock.resume();
    // Alt+ArrowDown opens it from the keyboard, on the shown tab's row.
    const currentRow = roster(page).locator(
      '[data-roster-row][aria-current=true]'
    );
    await chip.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(roster(page)).toBeVisible();
    await expect(currentRow).toBeFocused();
    await expect(currentRow).toContainText('Orchestrator');
    // The chip names its roster, whose rows carry the tree's levels.
    await expect(roster(page)).toHaveAttribute('id', /.+/);
    const rosterId = String(await roster(page).getAttribute('id'));
    await expect(chip).toHaveAttribute('aria-controls', rosterId);
    await expect(roster(page).locator('li[aria-level="1"]')).toContainText(
      'Orchestrator'
    );
    await expect(roster(page).locator('li[aria-level="2"]')).toContainText(
      player
    );
    await page.keyboard.press('Escape');
    await expect(roster(page)).toHaveCount(0);
    await expect(chip).toBeFocused();
    // So does Enter; a row chosen by keyboard shows its tab.
    await page.keyboard.press('Enter');
    await expect(currentRow).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(roster(page)).toHaveCount(0);
    await expect(chip).toHaveAttribute('aria-selected', 'true');
    await expect(activeLabel(page, CLAUDE)).toContainText(player);
    await expect(shownTerminal(page)).toContainText(ready(player));
  });

  test('marks the chip active when the shown tab joins its group', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    branches.push(spawnAgent(repoPath, homeDir));
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });

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
    // Tagged after it is shown: it joins the group's chip, still shown.
    tagTmuxSession(
      'late-player',
      orchestraTags({ orchestrator: CLAUDE }),
      homeDir
    );
    await expect(countOf(page, CLAUDE)).toHaveText('3', { timeout: 30_000 });
    await expect(stripTab(page, new RegExp(basename(dir)))).toHaveCount(0);
    await expect(chipOf(page, CLAUDE)).toHaveAttribute('aria-selected', 'true');
    await expect(activeLabel(page, CLAUDE)).toContainText(basename(dir));
    rmSync(dir, { recursive: true, force: true });
  });

  test('a press shows the group’s first tab, and Escape after a rest leaves the terminal its focus', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const player = spawnAgent(repoPath, homeDir);
    branches.push(player);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });
    const chip = chipOf(page, CLAUDE);

    await openRoster(page, chip);
    await rosterRows(page).filter({ hasText: player }).click();
    await expect(shownTerminal(page)).toContainText(ready(player));
    await page.mouse.move(0, 600);
    // A press is no rest: the roster stays shut past the rest's 400 ms.
    await page.clock.install();
    await chip.click();
    await page.clock.runFor(450);
    await expect(roster(page)).toHaveCount(0);
    await page.clock.resume();
    await expect(shownTerminal(page)).toContainText(CONDUCTOR_READY);

    await focusTerminal(page);
    await page.mouse.move(0, 600);
    await chip.hover();
    await page.clock.runFor(450);
    await expect(roster(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(roster(page)).toHaveCount(0);
    await page.clock.resume();
    await expect(chip).not.toBeFocused();
    await expect(page.locator('.xterm-helper-textarea:focus')).toHaveCount(1);
  });

  test('pressing another group’s chip closes an open roster, and shows that group’s first tab', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const codex = [
      spawnAgent(repoPath, homeDir, CODEX),
      spawnAgent(repoPath, homeDir, CODEX),
    ];
    branches.push(spawnAgent(repoPath, homeDir), ...codex);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('2', { timeout: 30_000 });
    await expect(countOf(page, CODEX)).toHaveText('2', { timeout: 30_000 });

    await openRoster(page, chipOf(page, CLAUDE));
    await chipOf(page, CODEX).click();
    await expect(roster(page)).toHaveCount(0);
    await expect(chipOf(page, CODEX)).toHaveAttribute('aria-selected', 'true');
  });

  test('shows a group of one tab as that tab, an orchestrator’s with its brain', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const player = spawnAgent(repoPath, homeDir, CODEX);
    branches.push(player);
    markOrchestrator(homeDir);
    const home = stripTab(page, new RegExp(basename(folder)));
    await expect(home.locator('svg.lucide-brain')).toBeVisible({
      timeout: 30_000,
    });
    await expect(stripTab(page, new RegExp(player))).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-group-chip]')).toHaveCount(0);
  });

  test('a roster row reorders within its group, and carries its tab out to a pane’s side', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const players = [
      spawnAgent(repoPath, homeDir),
      spawnAgent(repoPath, homeDir),
      spawnAgent(repoPath, homeDir),
    ];
    branches.push(...players);
    markOrchestrator(homeDir);
    await expect(countOf(page, CLAUDE)).toHaveText('4', { timeout: 30_000 });
    const chip = chipOf(page, CLAUDE);
    await openRoster(page, chip);
    const names = () =>
      rosterRows(page).evaluateAll((rows) =>
        rows.map((r) => r.getAttribute('data-roster-row'))
      );
    const [home, a, b, c] = await names();

    // The last row, dropped on the second's near half, goes before it,
    // and the roster stays open.
    const onto = await rosterRows(page).nth(1).boundingBox();
    await drag(
      page,
      rosterRows(page).nth(3),
      onto!.x + onto!.width / 2,
      onto!.y + 6
    );
    await expect.poll(names).toEqual([home, c, a, b]);
    await expect(roster(page)).toBeVisible();

    // Escape while a row is carried puts it back and leaves the roster
    // open as the rest opened it, so leaving it closes it.
    const from = await rosterRows(page).nth(3).boundingBox();
    await page.mouse.move(
      from!.x + from!.width / 2,
      from!.y + from!.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(onto!.x + onto!.width / 2, onto!.y + 6, {
      steps: 15,
    });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(roster(page)).toBeVisible();
    await expect.poll(names).toEqual([home, c, a, b]);
    await page.mouse.move(0, 600);
    await expect(roster(page)).toHaveCount(0);
    await openRoster(page, chip);

    // Carried to the pane's right side, a row splits it off there.
    const pane = await page.locator('[data-editor-panes]').boundingBox();
    await drag(
      page,
      rosterRows(page).nth(1),
      pane!.x + pane!.width * 0.97,
      pane!.y + pane!.height / 2
    );
    await expect(page.locator('[data-pane-id]')).toHaveCount(2);
    await expect(roster(page)).toHaveCount(0);
    await expect(countOf(page, CLAUDE)).toHaveText('3');
    await expect(
      page.locator('[data-pane-id]').nth(1).locator(`[data-tab-id="${c}"]`)
    ).toHaveCount(1);

    // A row carried onto the other pane's strip joins that pane, behind
    // a chip of its own group there.
    const panes = page.locator('[data-pane-id]');
    const paneCount = (i: number) =>
      panes.nth(i).locator(`[data-group-chip="${CLAUDE}"] [data-group-count]`);
    await openRoster(
      page,
      panes.nth(0).locator(`[data-group-chip="${CLAUDE}"]`)
    );
    const there = await panes
      .nth(1)
      .locator(`[data-tab-id="${c}"]`)
      .boundingBox();
    await drag(
      page,
      roster(page).locator(`[data-roster-row="${b}"]`),
      there!.x + there!.width - 8,
      there!.y + there!.height / 2
    );
    await expect(paneCount(1)).toHaveText('2');
    await expect(paneCount(0)).toHaveText('2');

    // That chip, carried onto the first pane's strip, takes its whole
    // group there, and the pane it leaves empty closes.
    const here = await panes
      .nth(0)
      .locator(`[data-group-chip="${CLAUDE}"]`)
      .boundingBox();
    await drag(
      page,
      panes.nth(1).locator(`[data-group-chip="${CLAUDE}"]`),
      here!.x + here!.width - 8,
      here!.y + here!.height / 2
    );
    await expect(panes).toHaveCount(1);
    await expect(countOf(page, CLAUDE)).toHaveText('4');
  });
});
