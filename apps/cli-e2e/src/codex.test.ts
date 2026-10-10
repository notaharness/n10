import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { fakeCli } from './setup/fake-cli.js';
import { sidebarLocator } from './setup/sidebar.js';
import {
  createSession,
  tabIntoSession,
  waitForSidebarFocused,
} from './setup/sessions.js';

const codex = fakeCli('codex');

test.use({
  n10Config: { agentId: 'codex', autoHideSidebar: false, keybindPreset: 'vim' },
  n10Env: async ({ fixtureHome }, provide) => {
    await provide(codex.install(fixtureHome));
  },
});

test('Codex launches and resumes the retained worktree through the TUI', async ({
  n10,
}) => {
  const cwd = join(n10.repoPath, '.claude/worktrees/codex-life');
  await createSession(n10.term, 'codex-life', { start: true });
  await expect(n10.term.getByText('fake-codex-ready').first()).toBeVisible();
  expect(codex.calls(cwd)).toMatchObject([{ args: [], cwd }]);
  codex.control(cwd, 'exit');
  // Native exit precedes the TUI's lifecycle update; Tab during that gap
  // focuses the terminal instead of opening its continuation menu.
  await expect(
    n10.term.page.locator('.term-row', { hasText: /◎\s*codex-life/ })
  ).toBeVisible();
  await n10.term.write('\x00');
  await waitForSidebarFocused(n10.term);
  await tabIntoSession(n10.term);
  await expect(n10.term.getByText('fake-codex-resumed').first()).toBeVisible();
  expect(codex.calls(cwd)).toMatchObject([
    { args: [] },
    { args: ['resume', '--last'], cwd },
  ]);
  // The same row, running its second process.
  const row = sidebarLocator(n10.term.page, 'codex-life');
  await expect(row.running().first()).toBeVisible();
  await expect(row.any()).toHaveCount(1);
});

test('Codex output becomes busy and then idle in the TUI sidebar', async ({
  n10,
}) => {
  const cwd = join(n10.repoPath, '.claude/worktrees/codex-busy');
  await createSession(n10.term, 'codex-busy', { start: true });
  await expect(n10.term.getByText('fake-codex-ready').first()).toBeVisible();
  await n10.term.write('\x00');
  await waitForSidebarFocused(n10.term);
  await createSession(n10.term, 'other');
  codex.control(cwd, 'busy');
  const row = n10.term.page.locator('.term-row', {
    hasText: /[●○].*codex-busy/,
  });
  await expect(row).toContainText(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, { timeout: 10_000 });
  await expect.poll(() => codex.worked(cwd)).toBe(true);
  codex.control(cwd, 'idle');
  await expect(n10.term.getByText('codex-busy is idle')).toBeVisible({
    timeout: 10_000,
  });
  await expect(row).not.toContainText(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  // Still running: idle is not an exit.
  await expect(
    n10.term.page.locator('.term-row', { hasText: /◎.*codex-busy/ })
  ).toHaveCount(0);
});
