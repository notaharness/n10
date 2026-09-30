import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  tab,
  visibleText,
} from './setup/app.js';
import { SHOWN_TERMINAL } from './setup/terminal-grid.js';
import { findN10SessionFor, tmuxClients } from './setup/tmux.js';

/**
 * The session host runs in its own utility process. One that dies is
 * started again: the agents it attached keep running in tmux, the new
 * host attaches to them, and the window reloads to watch it.
 */

const BANNER = 'n10-fake-agent-ready';

function hostPid(app: ElectronApplication): Promise<number | undefined> {
  return app.evaluate(
    ({ app: a }) =>
      a
        .getAppMetrics()
        .find((p) => p.type === 'Utility' && p.name === 'n10 host')?.pid
  );
}

/** The highest `working <n>` line the terminal on screen shows. */
async function latestWork(page: Page): Promise<number> {
  const text = await page.evaluate(
    (shown) => document.querySelector<HTMLElement>(shown)?.innerText ?? '',
    SHOWN_TERMINAL
  );
  return Math.max(
    0,
    ...[...text.matchAll(/working (\d+)/g)].map((m) => Number(m[1]))
  );
}

test.describe('A host that dies', () => {
  test.use({
    n10Config: { aiCommand: fakeAgent({ stream: true, intervalMs: 100 }) },
  });

  test('is started again, and the agent it left running shows current output', async ({
    desktop,
  }) => {
    const { app, page, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    await launchAgentFromRail(page);
    await expect(visibleText(page, BANNER)).toBeVisible({ timeout: 30_000 });
    const session = findN10SessionFor('alpha', homeDir)!;
    expect(tmuxClients(session, homeDir)).toHaveLength(1);
    const [deadClient] = tmuxClients(session, homeDir);
    await expect.poll(() => latestWork(page)).toBeGreaterThan(3);
    const before = await latestWork(page);

    const dead = await hostPid(app);
    expect(dead).toBeDefined();
    process.kill(dead!, 'SIGKILL');

    await expect
      .poll(
        async () => {
          const pid = await hostPid(app);
          return pid !== undefined && pid !== dead;
        },
        { timeout: 30_000 }
      )
      .toBe(true);
    expect(findN10SessionFor('alpha', homeDir)).toBe(session);

    await tab(page, /alpha/).click();
    await expect
      .poll(() => latestWork(page), { timeout: 30_000 })
      .toBeGreaterThan(before + 10);
    // The dead host's client went with it: the session has the new
    // host's client alone, not one of each.
    await expect.poll(() => tmuxClients(session, homeDir)).toHaveLength(1);
    expect(tmuxClients(session, homeDir)).not.toContain(deadClient);
  });
});
