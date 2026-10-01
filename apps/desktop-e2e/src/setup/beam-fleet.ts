import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test as base, expect } from '../fixtures/desktop.js';
import {
  startMachine,
  startTestkit,
  type BeamMachine,
  type Testkit,
} from './beam-testkit.js';
import { collapseFleet, openFleet } from './machines.js';
import { killFixtureSessions } from './tmux.js';

/** `laptop` is the daemon in the fixture HOME, which the app finds;
 *  `workbox` is another machine with a HOME of its own, `workboxHome`,
 *  whose tmux sessions it reaps after stopping. */
export const fleetTest = base.extend<{
  kit: Testkit;
  laptop: BeamMachine;
  workboxHome: string;
  workbox: BeamMachine;
}>({
  kit: async ({ fixtureHome }, provide) => {
    const kit = await startTestkit(fixtureHome);
    await provide(kit);
    await kit.stop();
  },
  laptop: async ({ fixtureHome, kit }, provide) => {
    const laptop = await startMachine(fixtureHome, kit);
    await provide(laptop);
    await laptop.stop();
  },
  workboxHome: async ({ fixtureHome }, provide) => {
    await provide(join(fixtureHome, 'workbox'));
  },
  workbox: async ({ workboxHome, kit }, provide) => {
    const workbox = await startMachine(workboxHome, kit);
    await provide(workbox);
    await workbox.stop();
    killFixtureSessions(workboxHome);
  },
  desktop: async ({ laptop, desktop }, provide) => {
    void laptop; // running first, so the app uses it rather than spawning one
    await provide(desktop);
  },
});

/** Creates the fleet from Fleet, joins `workbox` to it with the CLI,
 *  and waits for the app to show workbox connected. */
export async function formFleet(
  page: Page,
  workbox: BeamMachine
): Promise<void> {
  await openFleet({ page });
  await page.getByRole('button', { name: 'Create a fleet' }).click();
  await page.getByLabel('Machine name').fill('laptop');
  await page.getByLabel('Fleet name').fill('home');
  await page.getByRole('button', { name: 'Create fleet' }).click();
  await expect(page.getByTestId('machine-row')).toHaveCount(1, {
    timeout: 60_000,
  });

  const joined = await workbox.cli(['join', '--label', 'workbox']);
  expect(joined.code, joined.stderr).toBe(0);
  const rows = page.getByTestId('machine-row');
  await expect(
    rows.filter({ hasText: 'workbox' }).getByText('Connected')
  ).toBeVisible({ timeout: 60_000 });
  await expect(rows).toHaveCount(2);
  await collapseFleet(page);
}
