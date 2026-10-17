import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

const codex = fakeCli('codex');

test.use({
  fakeGitHub: { prs: [] },
  n10Config: { agentId: 'codex' },
  env: async ({ fixtureHome }, provide) => {
    await provide(codex.install(fixtureHome));
  },
});

test('Codex worktree launch, activity and recorded-agent continuation in Desktop', async ({
  desktop,
}) => {
  const { app, page, homeDir, repoPath } = desktop;
  const cwd = join(repoPath, '.claude/worktrees/codex-life');
  await createWorktree(page, 'codex-life');
  await page.getByRole('button', { name: 'Launch Agent', exact: true }).click();
  await expect(
    sessionMenu(page).getByRole('combobox', { name: 'Agent' })
  ).toHaveText('Codex (default)');
  await sessionMenu(page)
    .getByRole('button', { name: 'Start new session', exact: true })
    .click();
  await expect(page.getByText('fake-codex-ready').first()).toBeVisible();
  expect(codex.calls(cwd)).toMatchObject([{ args: [], cwd }]);
  codex.control(cwd, 'busy');
  await expect(agentSpinner(page).first()).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => codex.worked(cwd)).toBe(true);
  codex.control(cwd, 'idle');
  await expect(agentSpinner(page)).toHaveCount(0, { timeout: 10_000 });
  const name = findN10SessionFor('codex-life', homeDir)!;
  tagTmuxSession(
    name,
    {
      '@orchestra-orchestrator': 'codex:11111111-2222-4333-8444-555555555555',
      '@orchestra-last-report': 'PROGRESS 2026-09-09T14:32:00Z delivered',
    },
    homeDir
  );
  codex.control(cwd, 'exit');
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (
          await window.n10.listSessions((await window.n10.getRepo())!.cwd)
        ).map((session) => session.running)
      )
    )
    .toEqual([false]);
  // A changed default must not replace the recorded Codex conversation.
  writeFileSync(
    join(homeDir, '.n10/config.json'),
    JSON.stringify({ agentId: 'test', aiCommand: 'exit 42' })
  );
  await openAgentMenuFromCard(app, page);
  const menu = sessionMenu(page);
  await expect(
    menu.getByRole('button', { name: 'Continue with Codex', exact: true })
  ).toBeEnabled();
  await expect(
    menu.getByRole('region', { name: 'Orchestra context' })
  ).toContainText('PROGRESS');
  await menu
    .getByRole('button', { name: 'Continue with Codex', exact: true })
    .click();
  await expect(page.getByText('fake-codex-resumed').first()).toBeVisible();
  expect(codex.calls(cwd)).toMatchObject([
    { args: [] },
    { args: ['resume', '--last'], cwd },
  ]);
  expect(findN10SessionFor('codex-life', homeDir)).toBe(name);
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
  ).toBe(
    'codex\tcodex:11111111-2222-4333-8444-555555555555\tPROGRESS 2026-09-09T14:32:00Z delivered'
  );
});

test('Codex standalone terminal resumes in its existing Desktop tab', async ({
  desktop,
}) => {
  const { app, page, repoPath } = desktop;
  await openNewTerminalDialog(app, page);
  await confirmNewTerminal(page, 'Agent');
  await expect(page.getByText('fake-codex-ready').first()).toBeVisible();
  expect(codex.calls(repoPath)).toMatchObject([{ args: [], cwd: repoPath }]);
  codex.control(repoPath, 'exit');
  const resume = page.getByRole('button', {
    name: 'Resume agent',
    exact: true,
  });
  await expect(resume).toBeVisible({ timeout: 15_000 });
  await resume.click();
  await expect(page.getByText('fake-codex-resumed').first()).toBeVisible();
  expect(codex.calls(repoPath)).toMatchObject([
    { args: [] },
    { args: ['resume', '--last'] },
  ]);
  await expect(terminalTabs(page)).toHaveCount(1);
});
