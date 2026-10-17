import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, fakeAgent } from './fixtures/desktop.js';
import type { Page } from '@playwright/test';
import {
  createWorktree,
  focusTerminal,
  sessionCard,
  sessionMenu,
} from './setup/app.js';
import { fleetTest as test, formFleet } from './setup/beam-fleet.js';
import { BEAM_TEST_BINARY } from './setup/beam-testkit.js';
import { listTaggedSessions, paneOf } from './setup/tmux.js';

const BRANCH = 'remote-work';

/** Start a new agent for `BRANCH` on workbox from the tab's menu. */
async function launchOnWorkbox(page: Page) {
  await createWorktree(page, BRANCH);
  await page
    .getByRole('button', { name: /launch agent/i })
    .filter({ visible: true })
    .first()
    .click();
  const menu = sessionMenu(page);
  await menu.getByRole('combobox', { name: 'Machine' }).click();
  await page.getByRole('option', { name: /workbox/ }).click();
  await menu.getByRole('button', { name: 'Start new session' }).click();
  await expect(menu).toBeHidden({ timeout: 60_000 });
}

/** Records, from now on, every status the Agent card reads, in order. */
async function recordAgentStatus(page: Page) {
  await page.evaluate(() => {
    const w = window as { agentStatus?: string[] };
    w.agentStatus = [];
    const read = () => {
      const card = Array.from(
        document.querySelectorAll('[data-session-card]')
      ).find((el) => el.textContent?.includes('Agent'));
      const text = card?.textContent ?? '';
      const status = ['Waiting to reconnect', 'Running', 'Exited'].find((s) =>
        text.includes(s)
      );
      if (status && w.agentStatus?.at(-1) !== status)
        w.agentStatus?.push(status);
    };
    read();
    new MutationObserver(read).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  return () =>
    page.evaluate(
      () => (window as { agentStatus?: string[] }).agentStatus ?? []
    );
}

/** The worktree sessions on the machine with `home`. */
function remoteAgents(home: string) {
  return listTaggedSessions(home).filter((s) => s.type === 'worktree');
}

test.describe('Launching on another machine @beam', () => {
  test.skip(!BEAM_TEST_BINARY, 'needs a beamtest build: nx e2e:beam');
  test.slow();
  test.use({
    n10Config: { aiCommand: fakeAgent() },
    repo: { name: 'app', branches: [BRANCH] },
    repoInHome: true,
  });

  test('an agent opens in that machine’s clone under its own home', async ({
    desktop,
    workbox,
    workboxHome,
  }) => {
    const { page } = desktop;
    // workbox's user keeps the repository at the same place in their home.
    const clone = join(workboxHome, 'app');
    execFileSync('git', ['clone', '-q', desktop.repoPath, clone]);
    await formFleet(page, workbox);

    await launchOnWorkbox(page);

    // The checkout, and the process, are in workbox's clone.
    const checkout = join(realpathSync(clone), '.claude', 'worktrees', BRANCH);
    await expect
      .poll(() => remoteAgents(workboxHome).map((s) => s.worktreePath), {
        timeout: 30_000,
      })
      .toEqual([checkout]);
    const [{ name }] = remoteAgents(workboxHome);
    await expect
      .poll(() => paneOf(name, workboxHome).text, { timeout: 30_000 })
      .toContain('n10-fake-agent-ready');
    expect(paneOf(name, workboxHome).cwd).toBe(checkout);
  });

  // Neither exited nor gone: the agent may well still be running there.
  test('an agent on a machine that stops answering waits to reconnect', async ({
    desktop,
    workbox,
    workboxHome,
  }) => {
    const { page, app } = desktop;
    execFileSync('git', [
      'clone',
      '-q',
      desktop.repoPath,
      join(workboxHome, 'app'),
    ]);
    await formFleet(page, workbox);
    await launchOnWorkbox(page);
    await expect(sessionCard(page, 'Agent')).toContainText('Running', {
      timeout: 30_000,
    });
    await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });
    await focusTerminal(page);

    // Its daemon stops. A listing that never answers says so first, and
    // the fleet later marks the peer offline; from the first, the card
    // never reads Running again, whatever the transport hands back.
    const statuses = await recordAgentStatus(page);
    await workbox.stop();
    await expect(sessionCard(page, 'Agent')).toContainText(
      'Waiting to reconnect',
      { timeout: 60_000 }
    );
    await expect
      .poll(
        () =>
          page.evaluate(async () =>
            (await window.n10.listMachines()).map((m) => [m.label, m.state])
          ),
        { timeout: 60_000 }
      )
      .toContainEqual(['workbox', 'offline']);
    expect(await statuses()).toEqual(['Running', 'Waiting to reconnect']);
    await expect(
      page.getByRole('status').filter({ hasText: 'workbox' })
    ).toBeVisible();
    await page.keyboard.type('while away');
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      const [width = 1280, height = 800] = win.getSize();
      win.setSize(width - 120, height - 80);
    });
    await expect(page.getByText(/Error invoking remote method/)).toHaveCount(0);
    await expect(sessionCard(page, 'Agent')).not.toContainText('Exited');
  });

  // It neither answers nor says goodbye, so the fleet notices only late:
  // until then, only the deadline on its session listing does.
  test('an agent on a machine that freezes waits to reconnect, and comes back when it thaws', async ({
    desktop,
    workbox,
    workboxHome,
  }) => {
    const { page } = desktop;
    execFileSync('git', [
      'clone',
      '-q',
      desktop.repoPath,
      join(workboxHome, 'app'),
    ]);
    await formFleet(page, workbox);
    await launchOnWorkbox(page);
    await expect(sessionCard(page, 'Agent')).toContainText('Running', {
      timeout: 30_000,
    });

    const statuses = await recordAgentStatus(page);
    workbox.freeze();
    await expect(sessionCard(page, 'Agent')).toContainText(
      'Waiting to reconnect',
      { timeout: 30_000 }
    );
    await expect
      .poll(
        () =>
          page.evaluate(async () =>
            (await window.n10.listMachines()).map((m) => [m.label, m.state])
          ),
        { timeout: 90_000 }
      )
      .toContainEqual(['workbox', 'offline']);
    expect(await statuses()).toEqual(['Running', 'Waiting to reconnect']);

    workbox.thaw();
    await expect(sessionCard(page, 'Agent')).toContainText('Running', {
      timeout: 60_000,
    });
    expect(await statuses()).toEqual([
      'Running',
      'Waiting to reconnect',
      'Running',
    ]);
  });
});
