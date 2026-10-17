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
import { armContextMenuChoice, armContextMenuPeek } from './setup/menu.js';

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

test('a session takes its launch card’s place, and its card’s menu launches one more', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  await sidebarRow(page, /#214/).first().click();
  const launchAgent = page.getByRole('button', {
    name: 'Launch Agent',
    exact: true,
  });
  const launchTerminal = page.getByRole('button', {
    name: 'Launch Terminal',
    exact: true,
  });
  // Each kind has a row of its own, its card not started.
  await expect(launchTerminal).toContainText('Not started');
  const agentSlot = (await launchAgent.boundingBox())!;
  const terminalSlot = (await launchTerminal.boundingBox())!;
  expect(terminalSlot.x).toBeCloseTo(agentSlot.x, 0);
  expect(terminalSlot.width).toBeCloseTo(agentSlot.width, 0);
  expect(terminalSlot.y).toBeGreaterThan(agentSlot.y + agentSlot.height - 1);

  // The terminal's card replaces its launch card, the same size. The
  // rail itself moves under the bar the terminal's pane has, so the
  // place is measured from the agent's card above it.
  await launchTerminal.click();
  const terminal = sessionCard(page, 'Terminal');
  await expect(terminal).toContainText('Running');
  await expect(launchTerminal).toHaveCount(0);
  const agent = (await launchAgent.boundingBox())!;
  const card = (await terminal.boundingBox())!;
  expect(card.y - agent.y, 'place').toBeCloseTo(
    terminalSlot.y - agentSlot.y,
    0
  );
  for (const edge of ['x', 'width', 'height'] as const) {
    expect(card[edge], edge).toBeCloseTo(terminalSlot[edge], 0);
  }
  await expect(launchAgent).toBeVisible();

  // One more terminal, from the card's native menu, lists below.
  const menu = await armContextMenuPeek(app);
  await terminal.click({ button: 'right' });
  await expect
    .poll(async () => (await menu()).map((i) => i.label))
    .toEqual(['Launch additional terminal']);
  await armContextMenuChoice(app, 'Launch additional terminal');
  await terminal.click({ button: 'right' });
  await expect(sessionCards(page)).toHaveCount(2);
  await expect(sessionCards(page).nth(1)).toContainText('Terminal');
  await expect(launchTerminal).toHaveCount(0);
});
