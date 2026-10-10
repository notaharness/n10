import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { fakeCli } from './setup/fake-cli.js';
import { sidebarLocator } from './setup/sidebar.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

const gemini = fakeCli('gemini');

test.use({
  n10Config: {
    agentId: 'gemini',
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
  n10Env: async ({ fixtureHome }, provide) => {
    await provide(gemini.install(fixtureHome));
  },
});

test('Gemini rejects automatic resume and starts fresh only when selected in the TUI', async ({
  n10,
}) => {
  const cwd = join(n10.repoPath, '.claude/worktrees/gemini-life');
  await createSession(n10.term, 'gemini-life', { start: true });
  await expect(n10.term.getByText('fake-gemini-ready').first()).toBeVisible();
  expect(gemini.calls(cwd)).toMatchObject([{ args: [], cwd }]);
  gemini.control(cwd, 'exit');
  // Native exit precedes the TUI's lifecycle update; Tab during that gap
  // focuses the terminal instead of opening its continuation menu.
  await expect(
    n10.term.page.locator('.term-row', { hasText: /◎\s*gemini-life/ })
  ).toBeVisible();
  await n10.term.write('\x00');
  await waitForSidebarFocused(n10.term);
  await n10.term.press('Tab');
  await expect(n10.term.getByText('What would you like to do?')).toBeVisible();
  await n10.term.press('Enter');
  await expect(n10.term.getByText(/automatic resume/)).toBeVisible();
  expect(gemini.calls(cwd)).toHaveLength(1);
  await n10.term.press('ArrowRight');
  await expect(n10.term.getByText('Gemini (default)')).toBeVisible();
  await expect(n10.term.getByText('Start new session')).toBeVisible();
  await n10.term.press('Enter');
  await expect
    .poll(() => gemini.calls(cwd))
    .toMatchObject([{ args: [] }, { args: [], cwd }]);
  // The same row, running its second process.
  const row = sidebarLocator(n10.term.page, 'gemini-life');
  await expect(row.running().first()).toBeVisible();
  await expect(row.any()).toHaveCount(1);
});

test('Gemini output becomes busy and then idle in the TUI sidebar', async ({
  n10,
}) => {
  const cwd = join(n10.repoPath, '.claude/worktrees/gemini-busy');
  await createSession(n10.term, 'gemini-busy', { start: true });
  await expect(n10.term.getByText('fake-gemini-ready').first()).toBeVisible();
  await n10.term.write('\x00');
  await waitForSidebarFocused(n10.term);
  await createSession(n10.term, 'other');
  gemini.control(cwd, 'busy');
  const row = n10.term.page.locator('.term-row', {
    hasText: /[●○].*gemini-busy/,
  });
  await expect(row).toContainText(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, { timeout: 10_000 });
  await expect.poll(() => gemini.worked(cwd)).toBe(true);
  gemini.control(cwd, 'idle');
  await expect(n10.term.getByText('gemini-busy is idle')).toBeVisible({
    timeout: 10_000,
  });
  await expect(row).not.toContainText(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  // Still running: idle is not an exit.
  await expect(
    n10.term.page.locator('.term-row', { hasText: /◎.*gemini-busy/ })
  ).toHaveCount(0);
});
