import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, fakeAgent } from './fixtures/desktop.js';
import {
  focusTerminal,
  sessionCard,
  sessionCards,
  sessionMenu,
  sidebarRow,
  tabs,
  visibleText,
} from './setup/app.js';
import { fleetTest as test, formFleet } from './setup/beam-fleet.js';
import { BEAM_TEST_BINARY } from './setup/beam-testkit.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  uniqueExternalBranch,
} from './setup/external.js';

const BRANCH = 'remote-review';

test.describe('A pull request worked on another machine @beam', () => {
  test.skip(!BEAM_TEST_BINARY, 'needs a beamtest build: nx e2e:beam');
  test.slow();
  test.use({
    n10Config: { aiCommand: fakeAgent() },
    repo: {
      name: 'app',
      worktrees: [{ branch: BRANCH, files: { 'notes.md': 'remote\n' } }],
    },
    repoInHome: true,
    fakeGitHub: {
      username: 'n10-tester',
      prs: [{ number: 31, title: 'Remote review', headRefName: BRANCH }],
    },
  });

  // A session started outside the app, here, for discovery to find.
  const outside = uniqueExternalBranch();
  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, [outside], desktop.homeDir);
  });

  test('its agent and a terminal beside it name the machine they run on', async ({
    desktop,
    workbox,
    workboxHome,
  }) => {
    const { page } = desktop;
    const clone = join(workboxHome, 'app');
    execFileSync('git', ['clone', '-q', desktop.repoPath, clone]);
    await formFleet(page, workbox);
    await sidebarRow(page, /#31/).first().click();

    await page
      .getByRole('button', { name: 'Launch Agent', exact: true })
      .click();
    const menu = sessionMenu(page);
    await menu.getByRole('combobox', { name: 'Machine' }).click();
    await page.getByRole('option', { name: /workbox/ }).click();
    await menu.getByRole('button', { name: 'Start new session' }).click();
    await expect(menu).toBeHidden({ timeout: 60_000 });

    const agent = sessionCard(page, 'Agent');
    await expect(agent).toContainText('Running', { timeout: 30_000 });
    await expect(agent.getByTestId('session-machine')).toHaveText('workbox');
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });

    // Launch Terminal starts on the agent's machine and opens in the
    // pull request's checkout there.
    await page
      .getByRole('button', { name: 'Launch Terminal', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Launch terminal' });
    await expect(dialog.getByRole('combobox', { name: 'Machine' })).toHaveText(
      /workbox/
    );
    await dialog.getByRole('button', { name: 'Open terminal' }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });

    const terminal = sessionCard(page, 'Terminal');
    await expect(terminal.getByTestId('session-machine')).toHaveText('workbox');
    await expect(sessionCards(page)).toHaveCount(2);
    await focusTerminal(page);
    await page.keyboard.type('pwd\n');
    await expect(
      visibleText(
        page,
        join(realpathSync(clone), '.claude', 'worktrees', BRANCH)
      )
    ).toBeVisible({ timeout: 30_000 });
    await expect(tabs(page)).toHaveCount(1);

    // Discovery reads this machine's tmux, where the terminal is not.
    // A session started here from outside gets a tab once a scan has
    // adopted it. The terminal on workbox outlives that scan: it still
    // answers, and its card is still beside the agent's. (A terminal
    // the scan ended loses its card a moment after the new tab shows;
    // by then this input has gone to the agent instead.)
    const { repoPath, homeDir } = desktop;
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch: outside,
      worktreePath: addExternalWorktree(repoPath, outside),
      command: 'sleep 120',
    });
    await expect(tabs(page).filter({ hasText: outside })).toBeVisible({
      timeout: 30_000,
    });
    await focusTerminal(page);
    await page.keyboard.type('echo survived-$((6 * 7))\n');
    await expect(visibleText(page, 'survived-42')).toBeVisible({
      timeout: 30_000,
    });
    await expect(terminal).toContainText('Running');
    await expect(sessionCards(page)).toHaveCount(2);
  });
});
