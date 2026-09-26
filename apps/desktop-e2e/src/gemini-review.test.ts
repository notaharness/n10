import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { geminiCalls, installGemini } from './setup/gemini.js';
import { sessionMenu, sidebarRow } from './setup/app.js';

const branch = 'gemini-review';
const instruction =
  '--help is literal; preserve "quotes", $HOME and `code`.\nSecond line.';
test.use({
  fakeGitHub: {
    username: 'tester',
    prs: [
      { number: 42, title: 'Review Gemini integration', headRefName: branch },
    ],
  },
  repo: { worktrees: [{ branch }] },
});

test('Desktop selects Gemini for a review and preserves its interactive prompt', async ({
  desktop,
}) => {
  const { app, page, homeDir, repoPath } = desktop;
  await app.evaluate((_electron, env) => {
    Object.assign(process.env, env);
  }, installGemini(homeDir));
  await sidebarRow(page, /#42/).first().click();
  await page.getByRole('button', { name: 'Launch agent', exact: true }).click();
  const menu = sessionMenu(page);
  await menu.getByRole('radio', { name: 'Review', exact: true }).click();
  await menu.getByRole('combobox', { name: 'Agent' }).click();
  await page.getByRole('option', { name: 'Gemini', exact: true }).click();
  await menu.getByLabel('Additional instructions').fill(instruction);
  await menu.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.getByText('fake-gemini-ready').first()).toBeVisible();
  const cwd = join(repoPath, '.claude/worktrees', branch);
  const calls = geminiCalls(cwd);
  expect(calls).toHaveLength(1);
  expect(calls[0].cwd).toBe(cwd);
  expect(calls[0].args).toHaveLength(1);
  expect(calls[0].args[0]).toMatch(/^--prompt-interactive=/);
  expect(calls[0].args[0]).toContain(instruction);
  expect(calls[0].args[0]).toContain('n10 util add-comment');
});
