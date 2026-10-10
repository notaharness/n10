import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { wtermHost } from './setup/constants.js';
import {
  createSession,
  pressUntil,
  waitForSidebarFocused,
} from './setup/sessions.js';
import { pathWithoutTmux, processesRunning } from './setup/no-tmux.js';

/**
 * Without tmux the TUI owns its sessions itself: they run while it does
 * and end when it quits. One n10 owns a profile; another refuses to
 * start beside it rather than run a second set of sessions.
 */

const BINARY = fileURLToPath(
  new URL('../../cli/dist/main.js', import.meta.url)
);
const FAKE_AGENT = fileURLToPath(
  new URL('./fixtures/fake-agent.mjs', import.meta.url)
);

/** A second `n10 --tui` on the same HOME, until it exits. */
function startAnother(homeDir: string, path: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir, PATH: path };
  delete env.TMUX;
  delete env.TMUX_PANE;
  delete env.CI;
  return spawnSync(process.execPath, [BINARY, '--tui', homeDir], {
    env,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

async function n10Running(host: string): Promise<boolean> {
  const r = await fetch(`${host}/status`);
  return ((await r.json()) as { ptyAlive: boolean }).ptyAlive;
}

test.describe('Without tmux', () => {
  test.use({
    withoutTmux: true,
    n10Config: {
      agentId: 'test',
      aiCommand: fakeAgentCommand({ silent: true }),
      keybindPreset: 'vim',
    },
  });

  test('the TUI owns its agents, and they end when it quits', async ({
    n10,
    baseURL,
  }) => {
    const host = wtermHost(baseURL);
    const socket = join(n10.homeDir, '.n10', 'run', 'mux.sock');
    expect(existsSync(socket)).toBe(true);
    await createSession(n10.term, 'owned', { start: true });
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 20_000 });
    const agents = processesRunning(FAKE_AGENT, n10.homeDir);
    expect(agents).toHaveLength(1);

    const second = startAnother(
      n10.homeDir,
      join(n10.homeDir, '.path-without-tmux')
    );
    expect(second.status).toBe(1);
    expect(second.stderr).toContain(
      'Another n10 is already running without tmux'
    );

    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);
    await pressUntil(n10.term, 'q', async () => !(await n10Running(host)), {
      timeout: 10_000,
    });
    await expect
      .poll(() => processesRunning(FAKE_AGENT, n10.homeDir))
      .toEqual([]);
    expect(existsSync(socket)).toBe(false);
  });
});

test('an installed tmux that fails stops startup rather than replacing it', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'n10-e2e-web-home-'));
  try {
    const bin = join(homeDir, 'old-tmux');
    mkdirSync(bin);
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\necho "tmux 2.9"\n', {
      mode: 0o755,
    });
    const path = `${bin}:${pathWithoutTmux(process.env.PATH ?? '', homeDir)}`;
    const result = startAnother(homeDir, path);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('n10 requires tmux 3.2 or newer');
    expect(result.stderr).toMatch(/install/i);
    expect(existsSync(join(homeDir, '.n10', 'run', 'mux.sock'))).toBe(false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
