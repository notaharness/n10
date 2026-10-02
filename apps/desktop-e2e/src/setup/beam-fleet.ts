import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { Page, TestInfo } from '@playwright/test';
import { test as base, expect } from '../fixtures/desktop.js';
import {
  startMachine,
  startTestkit,
  type BeamMachine,
  type Testkit,
} from './beam-testkit.js';
import { collapseFleet, openFleet } from './machines.js';
import { killFixtureSessions, listTmuxSessions, paneOf } from './tmux.js';

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
  laptop: async ({ fixtureHome, kit }, provide, testInfo) => {
    const laptop = await startMachine(fixtureHome, kit);
    await provide(laptop);
    await attachLog(testInfo, 'laptop', laptop);
    await laptop.stop();
  },
  workboxHome: async ({ fixtureHome }, provide) => {
    await provide(join(fixtureHome, 'workbox'));
  },
  workbox: async ({ workboxHome, kit }, provide, testInfo) => {
    const workbox = await startMachine(workboxHome, kit);
    await provide(workbox);
    // A test that failed while it was frozen would leave the status
    // call below waiting for good.
    workbox.thaw();
    await attachLog(testInfo, 'workbox', workbox, panes(workboxHome));
    await workbox.stop();
    killFixtureSessions(workboxHome);
  },
  // The app's own log (N10_LOG), kept for a failed test.
  env: async ({ env, fixtureHome }, provide) => {
    await provide({ ...env, N10_LOG: join(fixtureHome, 'n10.log') });
  },
  desktop: async ({ laptop, desktop, fixtureHome }, provide, testInfo) => {
    void laptop; // running first, so the app uses it rather than spawning one
    await provide(desktop);
    // Playwright's own failure screenshot comes after the daemons stop,
    // when every peer reads offline.
    if (testInfo.status !== testInfo.expectedStatus) {
      await attachScreenshot(testInfo, desktop.page);
      await attachAppLog(testInfo, fixtureHome);
      await attachStreams(testInfo, desktop.page);
    }
  },
});

/** The app while the fleet is up, when it can still be drawn: a page
 *  that has crashed or closed is no reason to fail the teardown. */
async function attachScreenshot(testInfo: TestInfo, page: Page): Promise<void> {
  const path = testInfo.outputPath('fleet-up.png');
  const taken = await page.screenshot({ path }).then(
    () => true,
    () => false
  );
  if (taken)
    await testInfo.attach('fleet-up', { path, contentType: 'image/png' });
}

/** The app's log, when it wrote one: a missing file is no reason to
 *  fail the teardown and bury why the test failed. */
async function attachAppLog(testInfo: TestInfo, home: string): Promise<void> {
  const path = testInfo.outputPath('n10.log');
  const copied = await copyFile(join(home, 'n10.log'), path).then(
    () => true,
    () => false
  );
  if (copied)
    await testInfo.attach('n10-log', { path, contentType: 'text/plain' });
}

/**
 * Everything each session's stream has sent, as the host holds it, as
 * text. A tmux client that refuses to attach ("open terminal failed: …")
 * says so in its stream and exits; the terminal on screen then shows
 * the pane's last frame instead, so the refusal is only here.
 */
async function attachStreams(testInfo: TestInfo, page: Page): Promise<void> {
  const streams = await page
    .evaluate(async () => {
      const [sessions, terminals] = await Promise.all([
        window.n10.listSessions(),
        window.n10.listTerminals(),
      ]);
      const names = [
        ...new Set([...sessions, ...terminals].map((s) => s.name)),
      ];
      // One stream that cannot be read leaves the others.
      const read = await Promise.allSettled(
        names.map(async (name) => {
          try {
            return (await window.n10.watchSession(name)).data;
          } finally {
            await window.n10.unwatchSession(name);
          }
        })
      );
      return read.map((r, i) => ({
        name: names[i]!,
        text: r.status === 'fulfilled' ? r.value : `(${String(r.reason)})`,
      }));
    })
    .then((all) =>
      all
        .map(({ name, text }) => `${name}:\n${stripVTControlCharacters(text)}`)
        .join('\n\n')
    )
    .catch((err: unknown) => `streams: ${String(err)}`);
  const path = testInfo.outputPath('session-streams.log');
  await writeFile(path, streams);
  await testInfo.attach('session-streams', { path, contentType: 'text/plain' });
}

/** A failed test gets the machine's daemon log and its view of the
 *  fleet, which show why a peer dropped. */
async function attachLog(
  testInfo: TestInfo,
  name: string,
  machine: BeamMachine,
  extra = ''
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  const status = await machine
    .cli(['status', '--json'])
    .then(({ stdout, stderr }) => stdout || stderr)
    .catch((err: unknown) => String(err));
  // A file in the test's output directory, which CI uploads.
  const path = testInfo.outputPath(`beam-${name}.log`);
  await writeFile(
    path,
    `${machine.log()}\n\nbeam status --json:\n${status}${extra}`
  );
  await testInfo.attach(`beam-${name}`, { path, contentType: 'text/plain' });
}

/** What each of a home's tmux sessions shows, and where. */
function panes(home: string): string {
  try {
    return listTmuxSessions(home)
      .map((name) => {
        const { cwd, text } = paneOf(name, home);
        return `\n\n${name} in ${cwd}:\n${text}`;
      })
      .join('');
  } catch (err) {
    return `\n\ntmux: ${String(err)}`;
  }
}

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
