import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import {
  centre,
  markHeldReady,
  moveTo,
  restOn,
  shownTerminal,
  spareText,
} from './setup/prewarm.js';
import { startSurvivingTerminal } from './setup/terminals.js';
import {
  killFixtureSessions,
  n10SessionExists,
  tagTmuxSession,
} from './setup/tmux.js';

/**
 * An Orchestra orchestrator's tab: a terminal tab where `claude` was
 * run by hand and spawned players. Orchestra marks that session with
 * `@orchestra-target`, the target its players carry in
 * `@orchestra-orchestrator`; the strip groups the players' tabs under
 * it. Everything here is plain tmux tags on the test's own server.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const CLAUDE = 'claude:7c0ffee0-1234-4abc-8def-0123456789ab';
const CODEX = 'codex:01a10ed5-da8b-7120-bf36-8325cc735440';
const ORCHESTRATOR = 'conductor-shell';
const CONDUCTOR_READY = 'conductor-ready';

function orchestratorTab(page: Page) {
  return page.locator('[role=tab][data-orchestrator]');
}
function playerList(page: Page) {
  return page.locator('[data-orchestrator-players]');
}
function playerRows(page: Page) {
  return playerList(page).locator('[data-player-row]');
}
const ready = (branch: string) => `player-${branch}-ready`;

test.describe('Orchestrator tab', () => {
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

  /** A player spawned from the orchestrator: a worktree session made
   *  outside the app in `repoPath`, reporting to `target`. It prints
   *  its name once, unless `quiet`: output makes an agent active for a
   *  moment, and closing an active agent asks first. Then it runs
   *  `then`, if given, before it sleeps. */
  function spawnPlayer(
    repoPath: string,
    homeDir: string,
    { target = CLAUDE, quiet = false, then = '' } = {}
  ): string {
    const branch = uniqueExternalBranch();
    const name = startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath: addExternalWorktree(repoPath, branch),
      command: [
        quiet ? '' : `printf '%s\\n' ${ready(branch)}; `,
        then && `${then}; `,
        'sleep 300',
      ].join(''),
    });
    tagTmuxSession(name, { '@orchestra-orchestrator': target }, homeDir);
    return branch;
  }

  function markOrchestrator(homeDir: string, target = CLAUDE): void {
    tagTmuxSession(ORCHESTRATOR, { '@orchestra-target': target }, homeDir);
  }

  test('groups its players under it, counted where the X was, listed on hover @tmux', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    // In front, so the players open behind it.
    await createWorktree(page, 'alpha');
    const first = spawnPlayer(repoPath, homeDir);
    branches.push(first);
    const second = spawnPlayer(repoPath, homeDir);
    branches.push(second);
    markOrchestrator(homeDir);

    const orchestrator = orchestratorTab(page);
    await expect(orchestrator).toBeVisible({ timeout: 30_000 });
    await expect(orchestrator.locator('svg.lucide-brain')).toBeVisible();
    await expect(orchestrator.locator('[data-player-count]')).toHaveText('2', {
      timeout: 30_000,
    });
    await expect(
      orchestrator.getByRole('button', { name: 'Close tab' })
    ).toHaveCount(0);
    // The players' tabs leave the strip for the orchestrator's list.
    await expect(tab(page, new RegExp(first))).toHaveCount(0);
    await expect(tab(page, new RegExp(second))).toHaveCount(0);
    // They opened in the background, unseen: the orchestrator says so.
    await expect(orchestrator).toHaveAttribute('data-unseen', 'true');

    await orchestrator.hover();
    const rows = playerRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: first })).toHaveAttribute(
      'data-unseen',
      'true'
    );
    await expect(rows.filter({ hasText: second })).toBeVisible();

    // Choosing a row opens that player's tab: the strip's selection is
    // the orchestrator tab it stands under.
    await rows.filter({ hasText: second }).getByRole('button').first().click();
    await expect(orchestrator).toHaveAttribute('aria-selected', 'true');
    await expect(shownTerminal(page)).toContainText(ready(second));
    await page.mouse.move(0, 400);
    await orchestrator.hover();
    await expect(
      playerList(page).locator('[data-player-row][aria-current=true]')
    ).toHaveText(new RegExp(second));
  });

  test('groups players of other repositories and directories, under a Codex orchestrator @tmux', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    // A worktree of a repository that is not open, and an Orchestra dir
    // player in a directory of its own.
    const other = createTestRepo({ name: 'transloco' });
    const elsewhere = spawnPlayer(other, homeDir, { target: CODEX });
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
      { '@orchestra-orchestrator': CODEX },
      homeDir
    );
    markOrchestrator(homeDir, CODEX);

    const orchestrator = orchestratorTab(page);
    await expect(orchestrator.locator('[data-player-count]')).toHaveText('2', {
      timeout: 30_000,
    });
    await expect(tab(page, new RegExp(elsewhere))).toHaveCount(0);
    await expect(tab(page, new RegExp(basename(dir)))).toHaveCount(0);
    await orchestrator.hover();
    await expect(playerRows(page).filter({ hasText: elsewhere })).toBeVisible();
    await expect(
      playerRows(page).filter({ hasText: basename(dir) })
    ).toBeVisible();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a row's X closes that player as its tab's X would @tmux", async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const doomed = spawnPlayer(repoPath, homeDir, { quiet: true });
    branches.push(doomed);
    const kept = spawnPlayer(repoPath, homeDir, { quiet: true });
    branches.push(kept);
    markOrchestrator(homeDir);

    const orchestrator = orchestratorTab(page);
    await expect(orchestrator.locator('[data-player-count]')).toHaveText('2', {
      timeout: 30_000,
    });
    await orchestrator.hover();
    const rows = playerRows(page);
    await rows.filter({ hasText: doomed }).hover();
    await rows
      .filter({ hasText: doomed })
      .getByRole('button', { name: new RegExp(`^Close .*${doomed}`) })
      .click();

    await expect(orchestrator.locator('[data-player-count]')).toHaveText('1');
    await expect(rows).toHaveCount(1);
    await expect(rows.filter({ hasText: kept })).toBeVisible();
    // Closing a worktree tab stops its agent.
    await expect.poll(() => n10SessionExists(doomed, homeDir)).toBe(false);
    expect(n10SessionExists(kept, homeDir)).toBe(true);
  });

  test('with no players it keeps its X @tmux', async ({ desktop }) => {
    const { page, homeDir } = desktop;
    markOrchestrator(homeDir);

    const orchestrator = orchestratorTab(page);
    await expect(orchestrator).toBeVisible({ timeout: 30_000 });
    await expect(orchestrator.locator('svg.lucide-brain')).toBeVisible();
    await expect(orchestrator.locator('[data-player-count]')).toHaveCount(0);
    await expect(
      orchestrator.getByRole('button', { name: 'Close tab' })
    ).toHaveCount(1);
    await orchestrator.hover();
    await expect(playerList(page)).toHaveCount(0);
  });

  test('the keyboard walks its players after it, and focus opens no list @tmux', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    // The orchestrator's tab first, then alpha in front, so the players
    // open behind alpha: [orchestrator, alpha, player, player] in the
    // tabs' own order, which is not the order the strip shows.
    await expect(tab(page, /n10-conductor-/)).toBeVisible({ timeout: 30_000 });
    await createWorktree(page, 'alpha');
    const first = spawnPlayer(repoPath, homeDir);
    branches.push(first);
    const second = spawnPlayer(repoPath, homeDir);
    branches.push(second);
    markOrchestrator(homeDir);
    const orchestrator = orchestratorTab(page);
    await expect(orchestrator.locator('[data-player-count]')).toHaveText('2', {
      timeout: 30_000,
    });

    // Arrowing onto the tab moves focus there, and no card opens, though
    // a hover's would have in the same time.
    await page.clock.install();
    await orchestrator.hover();
    await page.clock.runFor(400);
    await expect(playerList(page)).toBeVisible();
    await page.mouse.move(0, 400);
    await page.clock.runFor(400);
    await expect(playerList(page)).toHaveCount(0);
    await tab(page, /alpha/).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(orchestrator).toBeFocused();
    await page.clock.runFor(400);
    await expect(playerList(page)).toHaveCount(0);
    await page.clock.resume();

    // From alpha, Ctrl+PgDn goes to the orchestrator, then through both
    // its players, the orchestrator selected all the while, then back.
    await tab(page, /alpha/).click();
    await page.keyboard.press('Control+PageDown');
    await expect(orchestrator).toHaveAttribute('aria-selected', 'true');
    await expect(shownTerminal(page)).toContainText(CONDUCTOR_READY);
    const player = /player-(e2e-ext-[0-9a-f]+)-ready/;
    const showing = async () =>
      player.exec((await shownTerminal(page).textContent()) ?? '')?.at(1);
    // One player's terminal, then the other's: each read waits out the
    // switch, when no player's terminal is on screen.
    await page.keyboard.press('Control+PageDown');
    await expect(orchestrator).toHaveAttribute('aria-selected', 'true');
    let one: string | undefined;
    await expect.poll(async () => (one = await showing())).toMatch(/^e2e-ext-/);
    expect([first, second]).toContain(one);
    await page.keyboard.press('Control+PageDown');
    await expect(orchestrator).toHaveAttribute('aria-selected', 'true');
    await expect
      .poll(showing)
      .toBe([first, second].find((branch) => branch !== one));
    await page.keyboard.press('Control+PageDown');
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');
  });

  test('a tap on it selects it @tmux', async ({ desktop }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    branches.push(spawnPlayer(repoPath, homeDir));
    markOrchestrator(homeDir);
    const orchestrator = orchestratorTab(page);
    await expect(orchestrator.locator('[data-player-count]')).toHaveText('1', {
      timeout: 30_000,
    });
    await expect(tab(page, /alpha/)).toHaveAttribute('aria-selected', 'true');

    const [x, y] = await centre(orchestrator);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect(orchestrator).toHaveAttribute('aria-selected', 'true');
  });

  test('resting on a row holds its pane ready, and pressing it shows that terminal @tmux', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    // In front, so the players open behind it.
    await createWorktree(page, 'alpha');
    const first = spawnPlayer(repoPath, homeDir);
    branches.push(first);
    const second = spawnPlayer(repoPath, homeDir);
    branches.push(second);
    markOrchestrator(homeDir);
    const orchestrator = orchestratorTab(page);
    await expect(orchestrator.locator('[data-player-count]')).toHaveText('2', {
      timeout: 30_000,
    });

    await page.clock.install();
    await moveTo(page, orchestrator);
    await page.clock.runFor(400);
    const row = playerRows(page).filter({ hasText: second });
    await expect(row).toBeVisible();
    await restOn(page, row, undefined, { fromHere: true });
    await expect.poll(() => spareText(page)).toContain(ready(second));
    await markHeldReady(page);

    await page.mouse.down();
    await expect(orchestrator).toHaveAttribute('aria-selected', 'true');
    await expect(shownTerminal(page)).toHaveCount(1);
    await expect(shownTerminal(page)).toHaveAttribute('data-held-ready', 'yes');
    await page.mouse.up();
  });

  test("a hidden player that finishes blinks the count of the selected orchestrator's tab @tmux", async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    // Works a streak once told to: long enough to count as work, then
    // quiet, which is what asks for attention.
    const go = join(folder, 'go');
    const worker = spawnPlayer(repoPath, homeDir, {
      then: `while [ ! -e ${go} ]; do sleep 0.2; done; for i in $(seq 50); do echo working-$i; sleep 0.12; done`,
    });
    branches.push(worker);
    markOrchestrator(homeDir);

    const orchestrator = orchestratorTab(page);
    const count = orchestrator.locator('[data-player-count]');
    await expect(count).toHaveText('1', { timeout: 30_000 });
    await orchestrator.hover();
    await playerRows(page).getByRole('button').first().click();
    await expect(shownTerminal(page)).toContainText(ready(worker));
    // Away from the player, onto the orchestrator's own terminal: the
    // tab stays selected, so only the count can show the player.
    await page.mouse.move(0, 400);
    await orchestrator.click();
    await expect(shownTerminal(page)).toContainText(CONDUCTOR_READY);
    await expect(count).not.toHaveAttribute('data-attention');

    writeFileSync(go, '');
    await expect(count).toHaveAttribute('data-attention', 'true', {
      timeout: 30_000,
    });
    await expect(count).toHaveClass(/count-attention/);
    await expect(orchestrator).toHaveAttribute('aria-selected', 'true');

    // Looking at the player clears it.
    await orchestrator.hover();
    await playerRows(page).getByRole('button').first().click();
    await expect(count).not.toHaveAttribute('data-attention', {
      timeout: 20_000,
    });
  });
});
