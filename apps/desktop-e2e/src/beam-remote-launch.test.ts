import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expect, fakeAgent } from './fixtures/desktop.js';
import { createWorktree, sessionMenu } from './setup/app.js';
import { fleetTest as test, formFleet } from './setup/beam-fleet.js';
import { BEAM_TEST_BINARY } from './setup/beam-testkit.js';
import { listTaggedSessions, paneOf } from './setup/tmux.js';

const BRANCH = 'remote-work';

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
});
