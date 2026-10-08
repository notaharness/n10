import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { tab } from './setup/app.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueExternalBranch,
} from './setup/external.js';
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

const TARGET = 'claude:7c0ffee0-1234-4abc-8def-0123456789ab';
const ORCHESTRATOR = 'conductor-shell';

function orchestratorTab(page: Page) {
  return page.locator('[role=tab][data-orchestrator]');
}
function playerList(page: Page) {
  return page.locator('[data-orchestrator-players]');
}

test.describe('Orchestrator tab', () => {
  let folder = '';
  let branches: string[] = [];

  test.beforeEach(({ desktop }) => {
    folder = mkdtempSync(join(tmpdir(), 'n10-conductor-'));
    branches = [];
    startSurvivingTerminal({
      name: ORCHESTRATOR,
      cwd: folder,
      command: 'sleep 300',
      homeDir: desktop.homeDir,
    });
  });

  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, branches, desktop.homeDir);
    killFixtureSessions(desktop.homeDir);
    rmSync(folder, { recursive: true, force: true });
  });

  /** A player spawned from the orchestrator: a worktree session made
   *  outside the app, reporting to `TARGET`. */
  function spawnPlayer(repoPath: string, homeDir: string): string {
    const branch = uniqueExternalBranch();
    branches.push(branch);
    const name = startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath: addExternalWorktree(repoPath, branch),
      command: 'sleep 300',
    });
    tagTmuxSession(name, { '@orchestra-orchestrator': TARGET }, homeDir);
    return branch;
  }

  test('groups its players under it, counted where the X was, listed on hover', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const first = spawnPlayer(repoPath, homeDir);
    const second = spawnPlayer(repoPath, homeDir);
    tagTmuxSession(ORCHESTRATOR, { '@orchestra-target': TARGET }, homeDir);

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

    await orchestrator.hover();
    const rows = playerList(page).locator('[data-player-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: first })).toBeVisible();
    await expect(rows.filter({ hasText: second })).toBeVisible();

    // Choosing a row opens that player's tab: the strip's selection is
    // the orchestrator tab it stands under.
    await rows.filter({ hasText: second }).getByRole('button').first().click();
    await expect(orchestrator).toHaveAttribute('aria-selected', 'true');
    await page.mouse.move(0, 400);
    await orchestrator.hover();
    await expect(
      playerList(page).locator('[data-player-row][aria-current=true]')
    ).toHaveText(new RegExp(second));
  });

  test("a row's X closes that player as its tab's X would", async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const doomed = spawnPlayer(repoPath, homeDir);
    const kept = spawnPlayer(repoPath, homeDir);
    tagTmuxSession(ORCHESTRATOR, { '@orchestra-target': TARGET }, homeDir);

    const orchestrator = orchestratorTab(page);
    await expect(orchestrator.locator('[data-player-count]')).toHaveText('2', {
      timeout: 30_000,
    });
    await orchestrator.hover();
    const rows = playerList(page).locator('[data-player-row]');
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

  test('with no players it keeps its X', async ({ desktop }) => {
    const { page, homeDir } = desktop;
    tagTmuxSession(ORCHESTRATOR, { '@orchestra-target': TARGET }, homeDir);

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
});
