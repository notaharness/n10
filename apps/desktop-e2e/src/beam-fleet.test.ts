import type { Page } from '@playwright/test';
import { expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  tab,
  visibleText,
} from './setup/app.js';
import { fleetTest as test, formFleet } from './setup/beam-fleet.js';
import { BEAM_TEST_BINARY, type BeamMachine } from './setup/beam-testkit.js';
import { collapseFleet, openFleet } from './setup/machines.js';
import { findN10SessionFor } from './setup/tmux.js';

const BRANCH = 'agent-work';

/** Launches the fake agent in a new worktree; its tmux name. */
async function startAgent(page: Page, fixtureHome: string): Promise<string> {
  await createWorktree(page, BRANCH);
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
  return findN10SessionFor(BRANCH, fixtureHome)!;
}

/** Sends workbox's Orchestra report to the agent `agent` on laptop. */
async function report(
  workbox: BeamMachine,
  laptop: BeamMachine,
  agent: string
): Promise<void> {
  const sent = await workbox.cli([
    'msg',
    'send',
    await laptop.peerId(),
    '--topic',
    'orchestra',
    `target: tmux:${agent}\n\nDONE from workbox`,
  ]);
  expect(sent.code, sent.stderr).toBe(0);
}

test.describe('A fleet of real beam daemons @beam', () => {
  test.skip(!BEAM_TEST_BINARY, 'needs a beamtest build: nx e2e:beam');
  // Two daemons, two ceremonies and a tunnel on top of the app's launch.
  test.slow();
  test.use({ n10Config: { aiCommand: fakeAgent({ echo: true }) } });

  test('a member’s report is typed into the agent it names', async ({
    desktop,
    laptop,
    workbox,
    fixtureHome,
  }) => {
    await formFleet(desktop.page, workbox);
    const agent = await startAgent(desktop.page, fixtureHome);

    await report(workbox, laptop, agent);
    await expect(
      visibleText(desktop.page, /echo:DONE from workbox/)
    ).toBeVisible({ timeout: 30_000 });
  });

  test('without a network this machine reads offline and its member unknown', async ({
    desktop,
    workbox,
  }) => {
    const { page } = desktop;
    await formFleet(page, workbox);
    await openFleet(desktop);
    const rows = page.getByTestId('machine-row');
    const laptopRow = rows.filter({ hasText: 'laptop' });
    const workboxRow = rows.filter({ hasText: 'workbox' });

    // The operating system's word, as Chromium hears it; beam's tunnel
    // runs over loopback and stays up.
    await page.context().setOffline(true);
    await expect(laptopRow.getByText('Offline', { exact: true })).toBeVisible();
    await expect(
      laptopRow.getByText('This machine cannot reach the fleet')
    ).toBeVisible();
    await expect(
      workboxRow.getByText('Unknown', { exact: true })
    ).toBeVisible();
    await expect(
      workboxRow.getByText('Unreachable', { exact: true })
    ).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(
      workboxRow.getByText('Connected', { exact: true })
    ).toBeVisible();
    await expect(
      laptopRow.getByText('This machine', { exact: true })
    ).toBeVisible();
  });

  test('a member granted only mail has its report refused, naming the grant', async ({
    desktop,
    laptop,
    workbox,
    fixtureHome,
  }) => {
    const { page } = desktop;
    await formFleet(desktop.page, workbox);
    const granted = await laptop.cli([
      'peer',
      'grant',
      await workbox.peerId(),
      'msg',
    ]);
    expect(granted.code, granted.stderr).toBe(0);
    const agent = await startAgent(page, fixtureHome);

    await report(workbox, laptop, agent);
    await openFleet(desktop);
    await expect(
      page.getByText(/Refused for tmux:.*grants the sender "msg"/)
    ).toBeVisible({ timeout: 30_000 });
    await collapseFleet(page);
    await tab(page, new RegExp(BRANCH)).click();
    await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible();
    await expect(visibleText(page, /echo:DONE/)).toHaveCount(0);
  });
});
