import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import {
  geminiCalls,
  geminiWorked,
  controlGemini,
  installGemini,
} from './setup/gemini.js';
import { agentSpinner, createWorktree, sessionMenu } from './setup/app.js';
import { findN10SessionFor, socketEnv, tagTmuxSession } from './setup/tmux.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

test.use({
  fakeGitHub: { prs: [] },
  n10Config: { agentId: 'gemini' },
  env: async ({ fixtureHome }, provide) => {
    await provide(installGemini(fixtureHome));
  },
});

test('Gemini worktree launch, activity and explicit fresh restart in Desktop', async ({
  desktop,
}) => {
  const { page, homeDir, repoPath } = desktop;
  const cwd = join(repoPath, '.claude/worktrees/gemini-life');
  await createWorktree(page, 'gemini-life');
  await page.getByRole('button', { name: 'Launch agent', exact: true }).click();
  await expect(
    sessionMenu(page).getByRole('combobox', { name: 'Agent' })
  ).toHaveText('Gemini (default)');
  await sessionMenu(page)
    .getByRole('button', { name: 'Start new session', exact: true })
    .click();
  await expect(page.getByText('fake-gemini-ready').first()).toBeVisible();
  expect(geminiCalls(cwd)).toMatchObject([{ args: [], cwd }]);
  controlGemini(cwd, 'busy');
  await expect(agentSpinner(page).first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => geminiWorked(cwd)).toBe(true);
  controlGemini(cwd, 'idle');
  await expect(agentSpinner(page)).toHaveCount(0, { timeout: 10_000 });
  const name = findN10SessionFor('gemini-life', homeDir)!;
  tagTmuxSession(
    name,
    {
      '@orchestra-orchestrator': 'tmux:fixture-orchestrator',
      '@orchestra-last-report': 'PROGRESS 2026-09-09T14:32:00Z',
    },
    homeDir
  );
  controlGemini(cwd, 'exit');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await window.n10.listSessions()).map((session) => session.running)
      )
    )
    .toEqual([false]);
  await page
    .getByRole('button', { name: 'Relaunch agent', exact: true })
    .click();
  const menu = sessionMenu(page);
  await expect(
    menu.getByRole('radio', { name: 'Continue', exact: true })
  ).toHaveCount(0);
  expect(geminiCalls(cwd)).toHaveLength(1);
  await menu
    .getByRole('button', { name: 'Start new session', exact: true })
    .click();
  await expect
    .poll(() => geminiCalls(cwd))
    .toMatchObject([{ args: [] }, { args: [], cwd }]);
  expect(findN10SessionFor('gemini-life', homeDir)).toBe(name);
  expect(
    execFileSync(
      'tmux',
      [
        'display-message',
        '-p',
        '-t',
        `=${name}:`,
        '#{@orchestra-agent}\t#{@orchestra-orchestrator}\t#{@orchestra-last-report}',
      ],
      { env: socketEnv(homeDir), encoding: 'utf8' }
    ).trim()
  ).toBe('gemini');
});

test('Gemini standalone terminal refuses resume and permits an explicit fresh start', async ({
  desktop,
}) => {
  const { app, page, repoPath } = desktop;
  await openNewTerminalDialog(app, page);
  await confirmNewTerminal(page, 'Agent');
  await expect(page.getByText('fake-gemini-ready').first()).toBeVisible();
  expect(geminiCalls(repoPath)).toMatchObject([{ args: [], cwd: repoPath }]);
  controlGemini(repoPath, 'exit');
  const resume = page.getByRole('button', {
    name: 'Resume agent',
    exact: true,
  });
  await expect(resume).toBeVisible({ timeout: 15_000 });
  await resume.click();
  await expect(page.getByRole('alert')).toContainText(
    'Gemini does not support automatic resume'
  );
  expect(geminiCalls(repoPath)).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Start new (directory default)', exact: true })
    .click();
  await expect
    .poll(() => geminiCalls(repoPath))
    .toMatchObject([{ args: [] }, { args: [] }]);
  await expect(terminalTabs(page)).toHaveCount(1);
});
