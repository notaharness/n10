import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { fakeCli } from './setup/fake-cli.js';
import {
  createSession,
  tabIntoSession,
  waitForSidebarFocused,
} from './setup/sessions.js';
import { listTaggedSessions } from './setup/tmux.js';

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
  const [before] = listTaggedSessions(n10.homeDir);
  codex.control(cwd, 'exit');
  await expect
    .poll(() => listTaggedSessions(n10.homeDir)[0]?.paneDead)
    .toBe(true);
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
  const [after] = listTaggedSessions(n10.homeDir);
  expect(after.name).toBe(before.name);
  expect(after.panePid).not.toBe(before.panePid);
  expect(after.paneDead).toBe(false);
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
  expect(listTaggedSessions(n10.homeDir)[0]?.paneDead).toBe(false);
});
