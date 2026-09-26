import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import {
  copilotCalls,
  copilotWorked,
  controlCopilot,
  installCopilot,
} from './setup/copilot.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';
import { listTaggedSessions } from './setup/tmux.js';

test.use({
  n10Config: {
    aiCommand: 'copilot',
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
  n10Env: async ({ fixtureHome }, provide) => {
    await provide(installCopilot(fixtureHome));
  },
});

test('Copilot rejects automatic resume and starts fresh only when selected in the TUI', async ({
  n10,
}) => {
  const cwd = join(n10.repoPath, '.claude/worktrees/copilot-life');
  await createSession(n10.term, 'copilot-life', { start: true });
  await expect(n10.term.getByText('fake-copilot-ready').first()).toBeVisible();
  expect(copilotCalls(cwd)).toMatchObject([{ args: [], cwd }]);
  const [before] = listTaggedSessions(n10.homeDir);
  controlCopilot(cwd, 'exit');
  await expect
    .poll(() => listTaggedSessions(n10.homeDir)[0]?.paneDead)
    .toBe(true);
  // Native exit precedes the TUI's lifecycle update; Tab during that gap
  // focuses the terminal instead of opening its continuation menu.
  await expect(
    n10.term.page.locator('.term-row', { hasText: /◎\s*copilot-life/ })
  ).toBeVisible();
  await n10.term.write('\x00');
  await waitForSidebarFocused(n10.term);
  await n10.term.press('Tab');
  await expect(n10.term.getByText('What would you like to do?')).toBeVisible();
  await n10.term.press('Enter');
  await expect(n10.term.getByText(/automatic resume/)).toBeVisible();
  expect(copilotCalls(cwd)).toHaveLength(1);
  await n10.term.press('ArrowRight');
  await expect(n10.term.getByText('Copilot (default)')).toBeVisible();
  await expect(n10.term.getByText('Start new session')).toBeVisible();
  await n10.term.press('Enter');
  await expect
    .poll(() => copilotCalls(cwd))
    .toMatchObject([{ args: [] }, { args: [], cwd }]);
  const [after] = listTaggedSessions(n10.homeDir);
  expect(after.name).toBe(before.name);
  expect(after.panePid).not.toBe(before.panePid);
  expect(after.paneDead).toBe(false);
});

test('Copilot output becomes busy and then idle in the TUI sidebar', async ({
  n10,
}) => {
  const cwd = join(n10.repoPath, '.claude/worktrees/copilot-busy');
  await createSession(n10.term, 'copilot-busy', { start: true });
  await expect(n10.term.getByText('fake-copilot-ready').first()).toBeVisible();
  await n10.term.write('\x00');
  await waitForSidebarFocused(n10.term);
  await createSession(n10.term, 'other');
  controlCopilot(cwd, 'busy');
  const row = n10.term.page.locator('.term-row', {
    hasText: /[●○].*copilot-busy/,
  });
  await expect(row).toContainText(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/, { timeout: 10_000 });
  await expect.poll(() => copilotWorked(cwd)).toBe(true);
  controlCopilot(cwd, 'idle');
  await expect(n10.term.getByText('copilot-busy is idle')).toBeVisible({
    timeout: 10_000,
  });
  await expect(row).not.toContainText(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  expect(listTaggedSessions(n10.homeDir)[0]?.paneDead).toBe(false);
});
