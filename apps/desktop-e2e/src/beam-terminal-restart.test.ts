import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect } from './fixtures/desktop.js';
import { focusTerminal, visibleText } from './setup/app.js';
import { fleetTest as test, formFleet } from './setup/beam-fleet.js';
import { BEAM_TEST_BINARY } from './setup/beam-testkit.js';
import {
  confirmNewTerminal,
  newTerminalDialog,
  openNewTerminalDialog,
  terminalSessions,
  terminalTabs,
} from './setup/terminals.js';

test.describe('A terminal on another machine @beam', () => {
  test.skip(!BEAM_TEST_BINARY, 'needs a beamtest build: nx e2e:beam');
  test.slow();
  test.use({ repo: { name: 'app' }, repoInHome: true });

  // Quitting n10 detaches it, and its tmux session runs on over there.
  // Discovery lists that machine's terminals, as it lists this one's,
  // so its tab comes back attached to the same session.
  test('comes back as a tab after a restart', async ({
    desktop,
    workbox,
    workboxHome,
  }) => {
    // workbox's user keeps the repository at the same place in their home.
    execFileSync('git', [
      'clone',
      '-q',
      desktop.repoPath,
      join(workboxHome, 'app'),
    ]);
    await formFleet(desktop.page, workbox);

    await openNewTerminalDialog(desktop.app, desktop.page);
    const dialog = newTerminalDialog(desktop.page);
    await dialog.getByRole('combobox', { name: 'Machine' }).click();
    await desktop.page.getByRole('option', { name: /workbox/ }).click();
    await confirmNewTerminal(desktop.page, 'Shell');
    await expect(terminalTabs(desktop.page)).toHaveCount(1, {
      timeout: 60_000,
    });
    await expect.poll(() => terminalSessions(workboxHome)).toHaveLength(1);
    const sessions = terminalSessions(workboxHome);
    await focusTerminal(desktop.page);
    await desktop.page.keyboard.type('echo before-$((6 * 7))\n');
    await expect(visibleText(desktop.page, 'before-42')).toBeVisible({
      timeout: 30_000,
    });

    await desktop.relaunch();
    const { page } = desktop;

    await expect(terminalTabs(page)).toHaveCount(1, { timeout: 60_000 });
    await terminalTabs(page).click();
    await focusTerminal(page);
    await page.keyboard.type('echo after-$((6 * 7))\n');
    await expect(visibleText(page, 'after-42')).toBeVisible({
      timeout: 30_000,
    });
    expect(terminalSessions(workboxHome)).toEqual(sessions);
  });
});
