import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { copilotCalls, installCopilot } from './setup/copilot.js';
import { sessionMenu, sidebarRow } from './setup/app.js';

const branch = 'copilot-review';
const instruction =
  '--help is literal; preserve "quotes", $HOME and `code`.\nSecond line.';
test.use({
  fakeGitHub: {
    username: 'tester',
    prs: [
      { number: 42, title: 'Review Copilot integration', headRefName: branch },
    ],
  },
  repo: { worktrees: [{ branch }] },
});

test('Desktop selects Copilot for a review and preserves its interactive prompt', async ({
  desktop,
}) => {
  const { app, page, homeDir, repoPath } = desktop;
  await app.evaluate((_electron, env) => {
    Object.assign(process.env, env);
  }, installCopilot(homeDir));
  await sidebarRow(page, /#42/).first().click();
  await page.getByRole('button', { name: 'Launch agent', exact: true }).click();
  const menu = sessionMenu(page);
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  await menu.getByRole('combobox', { name: 'Agent' }).click();
  await page.getByRole('option', { name: 'Copilot', exact: true }).click();
  await menu.getByLabel('Additional instructions').fill(instruction);
  await menu.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.getByText('fake-copilot-ready').first()).toBeVisible();
  const cwd = join(repoPath, '.claude/worktrees', branch);
  const calls = copilotCalls(cwd);
  expect(calls).toHaveLength(1);
  expect(calls[0].cwd).toBe(cwd);
  expect(calls[0].args).toHaveLength(1);
  expect(calls[0].args[0]).toMatch(/^--interactive=/);
  expect(calls[0].args[0]).toContain(instruction);
  expect(calls[0].args[0]).toContain('n10 util add-comment');
});
