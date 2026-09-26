import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import {
  geminiCalls,
  geminiWorked,
  controlGemini,
  installGemini,
} from './setup/gemini.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';
import { listTaggedSessions } from './setup/tmux.js';

test.use({
  n10Config: {
    aiCommand: 'gemini',
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
  n10Env: async ({ fixtureHome }, provide) => {
    await provide(installGemini(fixtureHome));
  },
});

test('Gemini rejects automatic resume and starts fresh only when selected in the TUI', async ({
  n10,
}) => {
  const cwd = join(n10.repoPath, '.claude/worktrees/gemini-life');
  await createSession(n10.term, 'gemini-life', { start: true });
  await expect(n10.term.getByText('fake-gemini-ready').first()).toBeVisible();
  expect(geminiCalls(cwd)).toMatchObject([{ args: [], cwd }]);
  const [before] = listTaggedSessions(n10.homeDir);
  controlGemini(cwd, 'exit');
  await expect
    .poll(() => listTaggedSessions(n10.homeDir)[0]?.paneDead)
    .toBe(true);
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
  expect(geminiCalls(cwd)).toHaveLength(1);
  await n10.term.press('ArrowRight');
  await expect(n10.term.getByText('Gemini (default)')).toBeVisible();
  await expect(n10.term.getByText('Start new session')).toBeVisible();
  await n10.term.press('Enter');
  await expect
    .poll(() => geminiCalls(cwd))
    .toMatchObject([{ args: [] }, { args: [], cwd }]);
  const [after] = listTaggedSessions(n10.homeDir);
  expect(after.name).toBe(before.name);
  expect(after.panePid).not.toBe(before.panePid);
  expect(after.paneDead).toBe(false);
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
  controlGemini(cwd, 'busy');
  const row = n10.term.page.locator('.term-row', {
    hasText: /[●○].*gemini-busy/,
  });
  await expect(row).toContainText(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, { timeout: 10_000 });
  await expect.poll(() => geminiWorked(cwd)).toBe(true);
  controlGemini(cwd, 'idle');
  await expect(n10.term.getByText('gemini-busy is idle')).toBeVisible({
    timeout: 10_000,
  });
  await expect(row).not.toContainText(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  expect(listTaggedSessions(n10.homeDir)[0]?.paneDead).toBe(false);
});
