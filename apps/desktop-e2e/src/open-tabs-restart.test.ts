import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  switchRepo,
  tabs,
  visibleText,
} from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import {
  confirmNewTerminal,
  openNewTerminalDialog,
  terminalTabs,
} from './setup/terminals.js';
import {
  killFixtureSessions,
  listTaggedSessions,
  socketEnv,
  tmuxAvailable,
  type TaggedTmuxSession,
} from './setup/tmux.js';

const test = base.extend<{ other: string }>({
  env: async ({ fixtureHome }, provide) => {
    await provide({ CLAUDE_CONFIG_DIR: join(fixtureHome, 'claude-original') });
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  other: async ({}, provide) => {
    const path = createTestRepo({ name: 'resume-foreign-repo' });
    await provide(path);
    cleanupTestRepo(path);
  },
});

test.skip(!tmuxAvailable(), 'tmux is not installed');
test.use({ n10Config: { aiCommand: fakeAgent() } });

interface SavedTabs {
  version: number;
  state: {
    activeId: string | null;
    tabs: {
      id: string;
      kind: string;
      repo?: string;
      restore?: {
        target: { kind: string; name: string };
        env?: Record<string, string>;
      };
    }[];
  };
}

function savedTabs(homeDir: string): SavedTabs | null {
  try {
    return JSON.parse(
      readFileSync(join(homeDir, '.n10', 'open-tabs.json'), 'utf8')
    ) as SavedTabs;
  } catch {
    return null;
  }
}

function tmuxEnv(name: string, homeDir: string, variable: string): string {
  return execFileSync(
    'tmux',
    ['show-environment', '-t', `=${name}:`, variable],
    {
      encoding: 'utf8',
      env: socketEnv(homeDir),
    }
  ).trim();
}

function requireSession(
  session: TaggedTmuxSession | undefined
): TaggedTmuxSession {
  if (!session) throw new Error('Expected tmux session did not start');
  return session;
}

test('relaunch reopens the same live terminal without a duplicate tab or session', async ({
  desktop,
}) => {
  await openNewTerminalDialog(desktop.app, desktop.page);
  await confirmNewTerminal(desktop.page, 'Shell');
  await expect(terminalTabs(desktop.page)).toHaveCount(1);
  await expect.poll(() => listTaggedSessions(desktop.homeDir)).toHaveLength(1);
  const original = requireSession(listTaggedSessions(desktop.homeDir)[0]);

  await desktop.relaunch();

  await expect(terminalTabs(desktop.page)).toHaveCount(1, { timeout: 30_000 });
  await expect(terminalTabs(desktop.page)).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(
    desktop.page.getByRole('button', { name: 'Resume session' })
  ).toHaveCount(0);
  expect(listTaggedSessions(desktop.homeDir)).toEqual([original]);

  await terminalTabs(desktop.page).getByLabel('Close tab').click();
  await desktop.page
    .getByRole('dialog')
    .filter({ hasText: 'Close terminal' })
    .getByRole('button', { name: /End session/ })
    .click();
  await expect(terminalTabs(desktop.page)).toHaveCount(0);
  await expect
    .poll(() => savedTabs(desktop.homeDir)?.state.tabs.length)
    .toBe(0);
  await desktop.relaunch();
  await expect(tabs(desktop.page)).toHaveCount(0);
  expect(listTaggedSessions(desktop.homeDir)).toEqual([]);
});

test('after a computer restart tabs wait for an explicit Resume session', async ({
  desktop,
}) => {
  await openNewTerminalDialog(desktop.app, desktop.page);
  await confirmNewTerminal(desktop.page, 'Agent');
  await expect(visibleText(desktop.page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  const agent = requireSession(listTaggedSessions(desktop.homeDir)[0]);
  expect(agent.type).toBe('agent');
  const originalConfig = join(desktop.homeDir, 'claude-original');

  await openNewTerminalDialog(desktop.app, desktop.page);
  await confirmNewTerminal(desktop.page, 'Shell');
  await expect(terminalTabs(desktop.page)).toHaveCount(2);
  await expect.poll(() => listTaggedSessions(desktop.homeDir)).toHaveLength(2);
  const originalSessions = listTaggedSessions(desktop.homeDir);
  const shell = requireSession(
    originalSessions.find((session) => session.type === 'shell')
  );
  await expect
    .poll(() => savedTabs(desktop.homeDir)?.state.tabs.length)
    .toBe(2);
  const before = savedTabs(desktop.homeDir)!;
  expect(before.version).toBe(1);
  expect(before.state.tabs.map((tab) => tab.restore?.target)).toEqual([
    { kind: 'tmux', name: agent.name },
    { kind: 'tmux', name: shell.name },
  ]);
  expect(before.state.activeId).toBe(before.state.tabs[1].id);

  await desktop.relaunch({
    whileClosed: () => killFixtureSessions(desktop.homeDir),
    env: { CLAUDE_CONFIG_DIR: join(desktop.homeDir, 'claude-next') },
  });

  expect(listTaggedSessions(desktop.homeDir)).toEqual([]);
  await expect(tabs(desktop.page)).toHaveCount(2, { timeout: 30_000 });
  await expect(terminalTabs(desktop.page)).toHaveCount(2);
  await expect(terminalTabs(desktop.page).last()).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(
    desktop.page.getByRole('button', { name: 'Resume session' })
  ).toBeVisible();
  expect(listTaggedSessions(desktop.homeDir)).toEqual([]);

  await terminalTabs(desktop.page).first().click();
  await expect(
    desktop.page.getByRole('button', { name: 'Resume session' })
  ).toBeVisible();
  expect(listTaggedSessions(desktop.homeDir)).toEqual([]);
  await desktop.page.getByRole('button', { name: 'Resume session' }).click();
  await expect(visibleText(desktop.page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => listTaggedSessions(desktop.homeDir)).toHaveLength(1);
  const [resumed] = listTaggedSessions(desktop.homeDir);
  expect(resumed).toEqual(agent);
  expect(tmuxEnv(resumed.name, desktop.homeDir, 'CLAUDE_CONFIG_DIR')).toBe(
    `CLAUDE_CONFIG_DIR=${originalConfig}`
  );
  await expect(tabs(desktop.page)).toHaveCount(2);

  await terminalTabs(desktop.page).last().click();
  await expect(
    desktop.page.getByRole('button', { name: 'Resume session' })
  ).toBeVisible();
  expect(listTaggedSessions(desktop.homeDir)).toEqual([agent]);
  await desktop.page.getByRole('button', { name: 'Resume session' }).click();
  await expect.poll(() => listTaggedSessions(desktop.homeDir)).toHaveLength(2);
  expect(listTaggedSessions(desktop.homeDir)).toEqual(originalSessions);
});

test('the selected foreign worktree tab resumes its original agent on demand', async ({
  desktop,
  other,
}) => {
  const alpha = 'resume-alpha';
  const beta = 'resume-beta';
  await createWorktree(desktop.page, alpha);
  await launchAgentFromRail(desktop.page);
  await expect(visibleText(desktop.page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });

  await switchRepo(desktop.page, other);
  await createWorktree(desktop.page, beta);
  await launchAgentFromRail(desktop.page);
  await expect.poll(() => listTaggedSessions(desktop.homeDir)).toHaveLength(2);
  const original = requireSession(
    listTaggedSessions(desktop.homeDir).find(
      (session) => session.branch === beta
    )
  );
  await expect(tabs(desktop.page)).toHaveCount(2);
  await expect
    .poll(() => savedTabs(desktop.homeDir)?.state.tabs.length)
    .toBe(2);
  await expect
    .poll(
      () =>
        savedTabs(desktop.homeDir)?.state.tabs.find((tab) => tab.repo === other)
          ?.restore?.target.name
    )
    .toBe(original.name);
  const before = savedTabs(desktop.homeDir)!;
  const foreign = before.state.tabs.find((tab) => tab.repo === other);
  expect(before.state.activeId).toBe(foreign?.id);
  expect(foreign?.restore?.target).toEqual({
    kind: 'tmux',
    name: original.name,
  });

  await desktop.relaunch({
    whileClosed: () => killFixtureSessions(desktop.homeDir),
    env: { CLAUDE_CONFIG_DIR: join(desktop.homeDir, 'claude-next') },
  });

  await expect
    .poll(() => desktop.page.evaluate(() => window.n10.getRepo()), {
      timeout: 30_000,
    })
    .toMatchObject({ cwd: other });
  await expect(tabs(desktop.page)).toHaveCount(2);
  await expect(tabs(desktop.page).filter({ hasText: beta })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await expect(
    desktop.page.getByRole('button', { name: 'Resume session' })
  ).toBeVisible();
  expect(listTaggedSessions(desktop.homeDir)).toEqual([]);

  await desktop.page.getByRole('button', { name: 'Resume session' }).click();
  await expect(visibleText(desktop.page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => listTaggedSessions(desktop.homeDir)).toHaveLength(1);
  expect(listTaggedSessions(desktop.homeDir)).toEqual([original]);
  expect(tmuxEnv(original.name, desktop.homeDir, 'CLAUDE_CONFIG_DIR')).toBe(
    `CLAUDE_CONFIG_DIR=${join(desktop.homeDir, 'claude-original')}`
  );
});
