import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  focusTerminal,
  launchAgentFromRail,
  sessionCard,
  sessionCards,
  sidebarRow,
  tabs,
  visibleText,
} from './setup/app.js';

/**
 * A pull request's review sidebar holds every session working in its
 * checkout: the agent and the terminals beside it, each a card that
 * shows its terminal in the pane and stops it.
 */

const BRANCH = 'cancel-requests';

test.use({
  fakeGitHub: {
    username: 'n10-tester',
    prs: [
      {
        number: 214,
        title: 'Handle cancelled requests',
        headRefName: BRANCH,
        author: 'alex',
      },
    ],
  },
  repo: {
    worktrees: [
      {
        branch: BRANCH,
        files: { 'request.ts': 'export function cancel() {}\n' },
      },
    ],
  },
  n10Config: { aiCommand: fakeAgent() },
});

test('a pull request holds its agent and a terminal in its checkout', async ({
  desktop,
}) => {
  const { page } = desktop;
  const checkout = join(
    realpathSync(desktop.repoPath),
    '.claude',
    'worktrees',
    BRANCH
  );
  await sidebarRow(page, /#214/).first().click();
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  await expect(sessionCard(page, 'Agent')).toContainText('Running');

  // Without another machine Launch Terminal opens here at once, and the
  // new terminal takes the pane.
  await page
    .getByRole('button', { name: 'Launch Terminal', exact: true })
    .click();
  await expect(sessionCards(page)).toHaveCount(2);
  const terminal = sessionCard(page, 'Terminal');
  await expect(terminal.locator('[aria-current="true"]')).toBeVisible();
  await focusTerminal(page);
  await page.keyboard.type('pwd\n');
  await expect(visibleText(page, checkout)).toBeVisible({ timeout: 15_000 });
  // It lives in the pull request's tab, not one of its own, and names
  // no machine: both run here.
  await expect(tabs(page)).toHaveCount(1);
  await expect(page.getByTestId('session-machine')).toHaveCount(0);

  // The agent's card brings its terminal back.
  await sessionCard(page, 'Agent')
    .getByRole('button', { name: /^Agent/ })
    .click();
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();

  await terminal.getByRole('button', { name: 'Stop terminal' }).click();
  await expect(sessionCards(page)).toHaveCount(1);
  await expect(sessionCard(page, 'Agent')).toContainText('Running');
});
