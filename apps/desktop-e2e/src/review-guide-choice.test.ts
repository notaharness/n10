import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { fakeCli } from './setup/fake-cli.js';
import { armContextMenuChoice } from './setup/menu.js';
import { sessionMenu, sidebarRow } from './setup/app.js';

const gemini = fakeCli('gemini');

const branch = 'guide-choice';
test.use({
  env: async ({ fixtureHome }, provide) => {
    await provide(gemini.install(fixtureHome));
  },
  fakeGitHub: {
    username: 'tester',
    prs: [{ number: 42, title: 'Retry blob reads', headRefName: branch }],
  },
  repo: { worktrees: [{ branch }] },
});

/** What core's review prompt adds when it asks for a guided review. */
const GUIDE_TASK = 'Then write a guided review of the pull request.';
const GUIDE_HELP = 'n10 util guide-help';

/** The launch dialog in Review mode, with Gemini, whose fake records
 *  the prompt it was started with. Over a running agent the dialog is
 *  the row's Session… menu item. */
async function reviewDialog(page: Page, running?: ElectronApplication) {
  if (running) {
    await armContextMenuChoice(running, 'Session…');
    await sidebarRow(page, /#42/).first().click({ button: 'right' });
  } else {
    await sidebarRow(page, /#42/).first().click();
    await page
      .getByRole('button', { name: 'Launch Agent', exact: true })
      .click();
  }
  const menu = sessionMenu(page);
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  await menu.getByRole('combobox', { name: 'Agent' }).click();
  await page.getByRole('option', { name: 'Gemini', exact: true }).click();
  return menu;
}

/** The prompt of the review started last. */
function lastPrompt(cwd: string, launches: number): string {
  const calls = gemini.calls(cwd);
  expect(calls).toHaveLength(launches);
  return calls[launches - 1].args.join(' ');
}

function rememberedChoice(homeDir: string): unknown {
  const prefs = JSON.parse(
    readFileSync(join(homeDir, '.n10', 'desktop-prefs.json'), 'utf8')
  ) as { guidedReview?: unknown };
  return prefs.guidedReview;
}

test('a review asks for a guided review while its box is checked, as it is at first', async ({
  desktop,
}) => {
  const { page, repoPath } = desktop;
  const menu = await reviewDialog(page);
  await expect(
    menu.getByRole('checkbox', { name: 'Guided review' })
  ).toBeChecked();
  await menu.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.getByText('fake-gemini-ready').first()).toBeVisible();

  const prompt = lastPrompt(join(repoPath, '.claude/worktrees', branch), 1);
  expect(prompt).toContain(GUIDE_TASK);
  expect(prompt).toContain(GUIDE_HELP);
});

test('an unchecked box leaves the guide out of the prompt, and stays unchecked after a restart @tmux', async ({
  desktop,
}) => {
  const { repoPath, homeDir } = desktop;
  const cwd = join(repoPath, '.claude/worktrees', branch);
  let menu = await reviewDialog(desktop.page);
  await menu.getByRole('checkbox', { name: 'Guided review' }).click();
  await expect(
    menu.getByRole('checkbox', { name: 'Guided review' })
  ).not.toBeChecked();
  await menu.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(
    desktop.page.getByText('fake-gemini-ready').first()
  ).toBeVisible();

  const prompt = lastPrompt(cwd, 1);
  expect(prompt).toContain('n10 util add-comment');
  expect(prompt).not.toContain(GUIDE_TASK);
  expect(prompt).not.toContain(GUIDE_HELP);
  expect(rememberedChoice(homeDir)).toBe(false);

  await desktop.relaunch();
  menu = await reviewDialog(desktop.page, desktop.app);
  await expect(
    menu.getByRole('checkbox', { name: 'Guided review' })
  ).not.toBeChecked();
  await menu
    .getByRole('button', { name: 'Stop and start review', exact: true })
    .click();
  await expect.poll(() => gemini.calls(cwd).length).toBe(2);
  expect(lastPrompt(cwd, 2)).not.toContain(GUIDE_HELP);
});
