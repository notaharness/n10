import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { muxRequest, muxRuntime, type MuxSummary } from '@n10/core/mux';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  openSessions,
  visibleText,
} from './setup/app.js';
import { SHOWN_TERMINAL } from './setup/terminal-grid.js';

/**
 * Without tmux the session host owns the profile's sessions itself:
 * they run as long as it does and end with it, whichever way it ends.
 */

test.use({
  withoutTmux: true,
  n10Config: { aiCommand: fakeAgent({ printSize: true }) },
});

const BANNER = 'n10-fake-agent-ready';

/** The agent process the terminal on screen reports. */
async function agentPid(page: Page): Promise<number> {
  let pid = 0;
  await expect
    .poll(
      async () => {
        const text = await page.evaluate(
          (shown) =>
            document.querySelector<HTMLElement>(shown)?.innerText ?? '',
          SHOWN_TERMINAL
        );
        pid = Number(/size:\d+x\d+#(\d+)/.exec(text)?.[1] ?? 0);
        return pid;
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0);
  return pid;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hostPid(app: ElectronApplication): Promise<number | undefined> {
  return app.evaluate(
    ({ app: a }) =>
      a
        .getAppMetrics()
        .find((p) => p.type === 'Utility' && p.name === 'n10 host')?.pid
  );
}

async function startAgent(page: Page, branch: string): Promise<number> {
  await createWorktree(page, branch);
  await launchAgentFromRail(page);
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
  return agentPid(page);
}

async function running(page: Page): Promise<number> {
  return (await openSessions(page)).filter((s) => s.running).length;
}

/** The tab waits for an explicit Resume, which starts a new agent. */
async function resumeWaitingTab(page: Page, ended: number): Promise<void> {
  const resume = page.getByRole('button', { name: 'Resume session' });
  await expect(resume).toBeVisible({ timeout: 30_000 });
  expect(await running(page)).toBe(0);
  await resume.click();
  await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
  const pid = await agentPid(page);
  expect(pid).not.toBe(ended);
  expect(alive(pid)).toBe(true);
}

test('owns its sessions, and they end when it quits', async ({ desktop }) => {
  const socket = join(desktop.homeDir, '.n10', 'run', 'mux.sock');
  const pid = await startAgent(desktop.page, 'owned');
  expect(alive(pid)).toBe(true);
  expect(existsSync(socket)).toBe(true);

  let closed: { agent: boolean; socket: boolean } | undefined;
  await desktop.relaunch({
    whileClosed: () => {
      closed = { agent: alive(pid), socket: existsSync(socket) };
    },
  });
  expect(closed).toEqual({ agent: false, socket: false });

  await resumeWaitingTab(desktop.page, pid);
});

test('a host that dies takes its sessions, and the next one owns the profile', async ({
  desktop,
}) => {
  const { app, page } = desktop;
  const pid = await startAgent(page, 'crashed');
  const dead = await hostPid(app);
  process.kill(dead!, 'SIGKILL');

  await expect
    .poll(
      async () => {
        const next = await hostPid(app);
        return next !== undefined && next !== dead;
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  await expect.poll(() => alive(pid), { timeout: 10_000 }).toBe(false);
  await resumeWaitingTab(page, pid);
});

test('answers mux clients about the sessions it owns', async ({ desktop }) => {
  await startAgent(desktop.page, 'answered');
  const runtime = muxRuntime({ HOME: desktop.homeDir });
  const status = await muxRequest(runtime, 'host.status', {});
  expect(status.result).toMatchObject({
    ownerType: 'desktop',
    sessionCount: 1,
  });
  const { parts } = await muxRequest(runtime, 'session.list', { capture: 0 });
  const [listed] = parts as MuxSummary[];
  expect(listed).toMatchObject({ processState: 'running' });
  expect(listed!.tags['@orchestra-worktree-path']).toContain('answered');
  expect(listed!.capture?.text).toContain(BANNER);
});
