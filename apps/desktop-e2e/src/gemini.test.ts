import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { fakeCli } from './setup/fake-cli.js';
import {
  agentSpinner,
  createWorktree,
  openAgentMenuFromCard,
  sessionMenu,
} from './setup/app.js';
import { findN10SessionFor, socketEnv, tagTmuxSession } from './setup/tmux.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';

const gemini = fakeCli('gemini');

test.use({
  fakeGitHub: { prs: [] },
  n10Config: { agentId: 'gemini' },
  env: async ({ fixtureHome }, provide) => {
    await provide(gemini.install(fixtureHome));
  },
});

test('Gemini worktree launch, activity and explicit fresh restart in Desktop', async ({
  desktop,
}) => {
  const { app, page, homeDir, repoPath } = desktop;
  const cwd = join(repoPath, '.claude/worktrees/gemini-life');
  await createWorktree(page, 'gemini-life');
  await page.getByRole('button', { name: 'Launch Agent', exact: true }).click();
  await expect(
    sessionMenu(page).getByRole('combobox', { name: 'Agent' })
  ).toHaveText('Gemini (default)');
  await sessionMenu(page)
    .getByRole('button', { name: 'Start new session', exact: true })
    .click();
  await expect(page.getByText('fake-gemini-ready').first()).toBeVisible();
  expect(gemini.calls(cwd)).toMatchObject([{ args: [], cwd }]);
  gemini.control(cwd, 'busy');
  await expect(agentSpinner(page).first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => gemini.worked(cwd)).toBe(true);
  gemini.control(cwd, 'idle');
  await expect(agentSpinner(page)).toHaveCount(0, { timeout: 10_000 });
  const name = findN10SessionFor('gemini-life', homeDir)!;
  tagTmuxSession(
    name,
    {
      '@orchestra-orchestrator': 'tmux:fixture-orchestrator',
      '@orchestra-last-report': 'PROGRESS 2026-09-09T14:32:00Z inbox',
    },
    homeDir
  );
  gemini.control(cwd, 'exit');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (
          await window.n10.listSessions((await window.n10.getRepo())!.cwd)
        ).map((session) => session.running)
      )
    )
    .toEqual([false]);
  await openAgentMenuFromCard(app, page);
  const menu = sessionMenu(page);
  await expect(
    menu.getByRole('radio', { name: 'Continue', exact: true })
  ).toHaveCount(0);
  expect(gemini.calls(cwd)).toHaveLength(1);
  await menu
    .getByRole('button', { name: 'Start new session', exact: true })
    .click();
  await expect
    .poll(() => gemini.calls(cwd))
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
  expect(gemini.calls(repoPath)).toMatchObject([{ args: [], cwd: repoPath }]);
  gemini.control(repoPath, 'exit');
  const resume = page.getByRole('button', {
    name: 'Resume agent',
    exact: true,
  });
  await expect(resume).toBeVisible({ timeout: 15_000 });
  await resume.click();
  await expect(page.getByRole('alert')).toContainText(
    'Gemini does not support automatic resume'
  );
  expect(gemini.calls(repoPath)).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Start default agent', exact: true })
    .click();
  await expect
    .poll(() => gemini.calls(repoPath))
    .toMatchObject([{ args: [] }, { args: [] }]);
  await expect(terminalTabs(page)).toHaveCount(1);
});
