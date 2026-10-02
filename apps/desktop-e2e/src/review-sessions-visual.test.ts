import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  launchAgentFromRail,
  sessionCards,
  sidebarRow,
  visibleText,
} from './setup/app.js';

/**
 * The review sidebar's sessions, pixel for pixel in the pinned
 * container (see `visual.test.ts`): the agent's and the terminal's
 * cards not started, then a running agent and the terminal opened
 * beside it in their places, the terminal's card the one on screen.
 */

const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Review sessions ${theme} @visual`, () => {
    test.use({
      desktopPrefs: { theme, nativeFrame: false },
      n10Config: { aiCommand: fakeAgent() },
      repo: {
        name: 'n10-visual',
        worktrees: [
          {
            branch: 'cancel-requests',
            files: { 'request.ts': 'export function cancel() {}\n' },
          },
        ],
      },
      fakeGitHub: {
        username: 'n10-tester',
        prs: [
          {
            number: 214,
            title: 'Handle cancelled requests',
            headRefName: 'cancel-requests',
            author: 'alex',
          },
        ],
      },
    });

    test('an agent and a terminal in the review sidebar', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await sidebarRow(page, /#214/).first().click();
      const sessions = page
        .locator('[data-review-sessions]')
        .filter({ visible: true });
      await expect(
        page.getByRole('button', { name: 'Launch Terminal', exact: true })
      ).toBeVisible({ timeout: 30_000 });
      await expect(sessions).toHaveScreenshot(
        `review-sessions-not-started-${theme}.png`,
        shot
      );
      await launchAgentFromRail(page);
      await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
        timeout: 30_000,
      });
      await page
        .getByRole('button', { name: 'Launch Terminal', exact: true })
        .click();
      await expect(sessionCards(page)).toHaveCount(2);
      await expect(sessions).toHaveScreenshot(
        `review-sessions-${theme}.png`,
        shot
      );
    });
  });
}
