import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, fakeAgent } from './fixtures/desktop.js';
import { terminalTabs } from './setup/terminals.js';
import {
  killFixtureSessions,
  listTaggedSessions,
  socketEnv,
  tmuxAvailable,
} from './setup/tmux.js';

const test = base.extend({
  env: async ({ fixtureHome }, provide) => {
    await provide({ CLAUDE_CONFIG_DIR: join(fixtureHome, 'claude-from-host') });
  },
  liveTerminals: async ({ fixtureHome }, provide) => {
    await provide({
      'external-agent': {
        kind: 'agent',
        agent: 'test',
        cwd: fixtureHome,
        command: "printf '%s\\n' externally-started-agent; sleep 300",
        env: { CLAUDE_CONFIG_DIR: join(fixtureHome, 'claude-from-session') },
      },
    });
  },
});

test.skip(!tmuxAvailable(), 'tmux is not installed');
test.use({ n10Config: { aiCommand: fakeAgent() } });

function savedConfigDir(homeDir: string): string | undefined {
  try {
    const snapshot = JSON.parse(
      readFileSync(join(homeDir, '.n10', 'open-tabs.json'), 'utf8')
    ) as {
      state: {
        tabs: { restore?: { env?: Record<string, string> } }[];
      };
    };
    return snapshot.state.tabs[0]?.restore?.env?.CLAUDE_CONFIG_DIR;
  } catch {
    return undefined;
  }
}

function tmuxConfigDir(name: string, homeDir: string): string {
  return execFileSync(
    'tmux',
    ['show-environment', '-t', `=${name}:`, 'CLAUDE_CONFIG_DIR'],
    { encoding: 'utf8', env: socketEnv(homeDir) }
  ).trim();
}

test('a discovered tab keeps its session config directory after reboot @tmux', async ({
  desktop,
}) => {
  const originalConfig = join(desktop.homeDir, 'claude-from-session');
  await expect(terminalTabs(desktop.page)).toHaveCount(1, { timeout: 30_000 });
  const [original] = listTaggedSessions(desktop.homeDir);
  expect(original).toBeDefined();
  expect(tmuxConfigDir(original.name, desktop.homeDir)).toBe(
    `CLAUDE_CONFIG_DIR=${originalConfig}`
  );
  await terminalTabs(desktop.page).click();
  await expect.poll(() => savedConfigDir(desktop.homeDir)).toBe(originalConfig);

  await desktop.relaunch({
    whileClosed: () => killFixtureSessions(desktop.homeDir),
    env: { CLAUDE_CONFIG_DIR: join(desktop.homeDir, 'claude-next') },
  });

  expect(listTaggedSessions(desktop.homeDir)).toEqual([]);
  await expect(terminalTabs(desktop.page)).toHaveCount(1, { timeout: 30_000 });
  await expect(
    desktop.page.getByRole('button', { name: 'Resume session' })
  ).toBeVisible();
  await desktop.page.getByRole('button', { name: 'Resume session' }).click();
  await expect.poll(() => listTaggedSessions(desktop.homeDir)).toHaveLength(1);
  expect(listTaggedSessions(desktop.homeDir)).toEqual([original]);
  expect(tmuxConfigDir(original.name, desktop.homeDir)).toBe(
    `CLAUDE_CONFIG_DIR=${originalConfig}`
  );
});
