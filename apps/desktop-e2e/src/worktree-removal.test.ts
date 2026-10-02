import { sessionBranch } from './setup/session-keys.js';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  agentSpinner,
  createWorktree,
  launchAgentFromRail,
  sidebarRow,
  tab,
  visibleText,
} from './setup/app.js';
import { armContextMenuChoice, armContextMenuDismiss } from './setup/menu.js';

const BRANCH = 'doomed';

async function openRemoveDialog(page: Page, app: ElectronApplication) {
  await armContextMenuChoice(app, 'Remove worktree…');
  await sidebarRow(page, new RegExp(BRANCH)).click({ button: 'right' });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Remove worktree?')).toBeVisible();
  return dialog;
}

/**
 * The test repo has no remote, so the host reports the branch as "not
 * pushed to upstream" — an overridable reason, which turns the confirm
 * button into "Force remove". Take whichever is offered.
 */
function confirmButton(dialog: Locator) {
  return dialog.getByRole('button', { name: /^(Remove|Force remove)$/ });
}

test.describe('Worktree removal', () => {
  test('removing from the context menu drops the row, the tab and the directory', async ({
    desktop,
  }) => {
    const { page, app, repoPath } = desktop;
    await createWorktree(page, BRANCH);
    const worktreeDir = join(repoPath, '.claude', 'worktrees', BRANCH);
    expect(existsSync(worktreeDir)).toBe(true);

    const dialog = await openRemoveDialog(page, app);
    await confirmButton(dialog).click();

    // The row goes immediately — removal is optimistic — and the tab
    // and the directory follow once git finishes.
    await expect(sidebarRow(page, new RegExp(BRANCH))).toHaveCount(0);
    await expect(tab(page, new RegExp(BRANCH))).toHaveCount(0);
    await expect
      .poll(() => existsSync(worktreeDir), { timeout: 20_000 })
      .toBe(false);
  });

  // An agent can commit while the dialog is open. Nothing it did then
  // was judged, so the removal keeps everything and says why.
  test('a worktree that changed after the dialog opened keeps its row and tab', async ({
    desktop,
  }) => {
    const { page, app, repoPath } = desktop;
    await createWorktree(page, BRANCH);
    const worktreeDir = join(repoPath, '.claude', 'worktrees', BRANCH);

    const dialog = await openRemoveDialog(page, app);
    await expect(confirmButton(dialog)).toBeVisible();
    execFileSync(
      'git',
      ['commit', '-q', '--allow-empty', '-m', 'after the check'],
      { cwd: worktreeDir }
    );
    await confirmButton(dialog).click();

    await expect(
      page.getByText(`Kept ${BRANCH}: it changed after the check`)
    ).toBeVisible({ timeout: 20_000 });
    await expect(sidebarRow(page, new RegExp(BRANCH))).toBeVisible();
    await expect(tab(page, new RegExp(BRANCH))).toBeVisible();
    expect(existsSync(worktreeDir)).toBe(true);
  });

  // Forcing takes whatever is uncommitted when it runs, not only what
  // the check saw; unpushed commits alone need no force.
  test('Force remove says it discards whatever is uncommitted', async ({
    desktop,
  }) => {
    const { page, app, repoPath } = desktop;
    await createWorktree(page, BRANCH);
    const note = /discards whatever is uncommitted when it runs/;

    let dialog = await openRemoveDialog(page, app);
    await expect(confirmButton(dialog)).toBeVisible();
    await expect(dialog.getByText(note)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    execFileSync('touch', [
      join(repoPath, '.claude', 'worktrees', BRANCH, 'draft.txt'),
    ]);
    dialog = await openRemoveDialog(page, app);
    await expect(dialog.getByText(note)).toBeVisible();
  });

  test('cancelling leaves the worktree alone', async ({ desktop }) => {
    const { page, app, repoPath } = desktop;
    await createWorktree(page, BRANCH);

    const dialog = await openRemoveDialog(page, app);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Remove worktree?')).toHaveCount(0);
    await expect(sidebarRow(page, new RegExp(BRANCH))).toBeVisible();
    expect(existsSync(join(repoPath, '.claude', 'worktrees', BRANCH))).toBe(
      true
    );
  });

  test('dismissing the context menu without choosing does nothing', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await createWorktree(page, BRANCH);

    await armContextMenuDismiss(app);
    await sidebarRow(page, new RegExp(BRANCH)).click({ button: 'right' });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(sidebarRow(page, new RegExp(BRANCH))).toBeVisible();
  });
});

/**
 * Records, from now on, whether the pane ever shows "Preparing <label>…",
 * the placeholder a tab sits on while it waits for its sidebar row.
 */
async function watchForPreparing(page: Page, label: string) {
  await page.evaluate((text) => {
    const w = window as { sawPreparing?: boolean };
    w.sawPreparing = false;
    new MutationObserver(() => {
      if (document.body.innerText.includes(text)) w.sawPreparing = true;
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, `Preparing ${label}`);
  return () =>
    page.evaluate(() => (window as { sawPreparing?: boolean }).sawPreparing);
}

/**
 * Removing a worktree without n10 — from a shell, a script, another
 * tool. The app has to notice on its own, and a tab left behind would
 * sit on "Preparing…" forever, waiting for a row that is gone.
 * Nothing is pressed after the removal: noticing is the whole point.
 */
test.describe('Worktree removed outside n10', () => {
  // A branch with a slash, whose directory is named apart from it.
  const branch = 'ci/release-workflow';
  const dir = (repoPath: string) =>
    join(repoPath, '.claude', 'worktrees', 'ci-release-workflow');
  const removals: [string, (repoPath: string) => void][] = [
    [
      'git worktree remove',
      (repoPath) =>
        execFileSync('git', ['worktree', 'remove', dir(repoPath)], {
          cwd: repoPath,
          stdio: 'ignore',
        }),
    ],
    [
      'deleting its directory',
      (repoPath) => rmSync(dir(repoPath), { recursive: true, force: true }),
    ],
  ];

  for (const [how, remove] of removals) {
    test(`${how} closes its open tab and drops its row`, async ({
      desktop,
    }) => {
      const { page, repoPath } = desktop;
      await createWorktree(page, branch);
      await expect(tab(page, branch)).toHaveAttribute('aria-selected', 'true');
      const sawPreparing = await watchForPreparing(page, branch);

      remove(repoPath);

      await expect(tab(page, branch)).toHaveCount(0, { timeout: 20_000 });
      await expect(sidebarRow(page, branch)).toHaveCount(0);
      expect(await sawPreparing()).toBe(false);
    });
  }
});

/**
 * The merged-branch sweep removes a worktree through the same guarded
 * command as the remove dialog, and its tab closes the same way.
 */
test.describe('Worktree removed by the merged-branch sweep', () => {
  const branch = 'shipped';
  test.use({
    fakeGitHub: { prs: [], merged: [branch] },
    n10Config: { autoDeleteOnMerge: true },
  });

  let remote: string;
  test.beforeEach(() => {
    remote = mkdtempSync(join(tmpdir(), 'n10-e2e-origin-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
  });
  test.afterEach(() => {
    rmSync(remote, { recursive: true, force: true });
  });

  test('closes its open tab and drops its row', async ({ desktop }) => {
    const { page, repoPath } = desktop;
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repoPath, stdio: 'ignore' });
    git('remote', 'add', 'origin', remote);
    git('push', '-q', 'origin', 'main');
    await createWorktree(page, branch);
    // Pushed, so nothing would be lost: the sweep's guard lets it go.
    git('push', '-q', '-u', 'origin', branch);
    await expect(tab(page, branch)).toHaveAttribute('aria-selected', 'true');
    const sawPreparing = await watchForPreparing(page, branch);

    await page
      .getByRole('button', { name: 'Refresh', exact: true })
      .first()
      .click();

    await expect(
      page.getByText(`Auto-deleted merged branch: ${branch}`)
    ).toBeVisible({ timeout: 20_000 });
    await expect(tab(page, branch)).toHaveCount(0);
    await expect(sidebarRow(page, branch)).toHaveCount(0);
    expect(await sawPreparing()).toBe(false);
  });
});

/**
 * The same, with an agent still running in the worktree. The agent
 * outlives its directory, so its tab stays, says the worktree is gone
 * and offers to stop it; it closes once the agent is gone.
 */
test.describe('Worktree removed outside n10 (running agent)', () => {
  const removals: [string, (repoPath: string, dir: string) => void][] = [
    [
      'git worktree remove --force',
      (repoPath, dir) =>
        execFileSync('git', ['worktree', 'remove', '--force', dir], {
          cwd: repoPath,
          stdio: 'ignore',
        }),
    ],
    [
      'deleting its directory',
      (_repoPath, dir) => rmSync(dir, { recursive: true, force: true }),
    ],
  ];

  /** A worktree with an agent running in it, removed with `remove`. */
  async function removeUnderAgent(
    page: Page,
    repoPath: string,
    remove: (repoPath: string, dir: string) => void
  ) {
    await createWorktree(page, BRANCH);
    await launchAgentFromRail(page);
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });
    remove(repoPath, join(repoPath, '.claude', 'worktrees', BRANCH));
    await expect(
      tab(page, new RegExp(`${BRANCH}.*Worktree removed`))
    ).toBeVisible({ timeout: 20_000 });
  }

  test.describe('stopped from its tab', () => {
    test.use({ n10Config: { aiCommand: fakeAgent() } });

    for (const [how, remove] of removals) {
      test(`${how} keeps the agent's tab until it is stopped`, async ({
        desktop,
      }) => {
        const { page, repoPath } = desktop;
        await removeUnderAgent(page, repoPath, remove);
        await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();

        await page
          .getByRole('button', { name: 'Stop agent' })
          .filter({ visible: true })
          .click();

        await expect(tab(page, new RegExp(BRANCH))).toHaveCount(0, {
          timeout: 20_000,
        });
        await expect(sidebarRow(page, new RegExp(BRANCH))).toHaveCount(0);
        expect(await agentRunning(page)).toBe(false);
      });
    }
  });

  test.describe('exiting on its own', () => {
    test.use({ n10Config: { aiCommand: fakeAgent({ exitAfterMs: 12_000 }) } });

    test('closes the tab when the agent exits', async ({ desktop }) => {
      const { page, repoPath } = desktop;
      await removeUnderAgent(page, repoPath, removals[1]![1]);

      await expect(tab(page, new RegExp(BRANCH))).toHaveCount(0, {
        timeout: 40_000,
      });
    });
  });
});

/** Whether the host holds a live agent for `BRANCH`. */
async function agentRunning(page: Page): Promise<boolean> {
  const sessions = await page.evaluate(() => window.n10.listSessions());
  return (
    sessions.find((s) => sessionBranch(s.name) === BRANCH)?.running ?? false
  );
}

test.describe('Worktree removal (running agent)', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ stream: true }) } });

  test('removing a worktree stops the agent running in it', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await createWorktree(page, BRANCH);

    await launchAgentFromRail(page);
    await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(agentSpinner(page).first()).toBeVisible({ timeout: 15_000 });

    const dialog = await openRemoveDialog(page, app);
    // The dialog says so out loud when an agent is running.
    await expect(dialog.getByText(/stops its running agent/)).toBeVisible();
    await confirmButton(dialog).click();

    await expect(sidebarRow(page, new RegExp(BRANCH))).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const sessions = await page.evaluate(() => window.n10.listSessions());
          return (
            sessions.find((s) => sessionBranch(s.name) === BRANCH)?.running ??
            false
          );
        },
        { timeout: 20_000 }
      )
      .toBe(false);
  });
});
