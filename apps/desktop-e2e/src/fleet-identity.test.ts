import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/fake-beam.js';
import { SELF_PEER_ID, WORKBOX, type FakeBeam } from './setup/fake-beam.js';
import { fleetView, collapseFleet, openFleet } from './setup/machines.js';

/**
 * This machine's fleet identity and what hangs off it
 * (beam-fleet-ux.md §1, §2): the fleet fingerprint from beam's status,
 * adding a machine, the join's fingerprint check, a pending directory
 * write and beam still preparing its network.
 */

async function finishJoin(page: Page, beam: FakeBeam) {
  const view = fleetView(page);
  await view.getByRole('button', { name: 'Join a fleet' }).click();
  await view.getByRole('button', { name: 'Join fleet' }).click();
  await expect(view.getByTestId('ceremony-url')).toBeVisible();
  beam.finishCeremony();
}

/** Creates a fleet whose directory write beam leaves pending. */
async function finishCreatePending(page: Page, beam: FakeBeam) {
  const view = fleetView(page);
  await view.getByRole('button', { name: 'Create a fleet' }).click();
  await view.getByRole('button', { name: 'Create fleet' }).click();
  await expect(view.getByTestId('ceremony-url')).toBeVisible();
  beam.nextPasskeyStep();
  beam.finishCeremony('pending');
}

test.describe('An enrolled machine', () => {
  test.use({
    beamScenario: {
      enrolled: true,
      peers: [{ peerId: WORKBOX, label: 'workbox' }],
    },
  });

  test('shows and copies the fleet fingerprint beam status reports', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await expect(fleetView(page).getByTestId('fleet-fingerprint')).toHaveText(
      '3f9a 0c4e 7d12 e805'
    );
    await fleetView(page)
      .getByRole('button', { name: 'Copy fleet fingerprint' })
      .click();
    await expect
      .poll(() => desktop.app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('3f9a 0c4e 7d12 e805');
  });

  test('a machine row copies the fingerprint it shows', async ({ desktop }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await fleetView(page)
      .getByRole('button', { name: 'c0ff ee00 c0ff ee00' })
      .click();
    await expect
      .poll(() => desktop.app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('c0ff ee00 c0ff ee00');
  });

  test('explains how to add a desktop or a headless machine', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await page.getByRole('button', { name: 'Add a machine' }).click();
    const panel = fleetView(page);
    await expect(
      panel.getByText(/On the other machine, open Fleet → Join a fleet/)
    ).toBeVisible();
    await expect(panel.getByText('beam join --label buildbox')).toBeVisible();
    await expect(panel.getByText('3f9a 0c4e 7d12 e805')).toBeVisible();
    expect(beam!.ops('join.start')).toHaveLength(0);
  });
  test('adding tracks new identities even while collapsed', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    const add = page.getByRole('button', {
      name: 'Add a machine',
      exact: true,
    });
    await expect(add).toBeVisible();
    await add.hover();
    await expect(
      page.getByRole('tooltip', { name: 'Add a machine' })
    ).toBeVisible();
    await add.click();
    await expect(
      fleetView(page).getByTestId('add-machine-panel')
    ).toBeVisible();
    beam!.peerChanged({ peerId: WORKBOX, label: 'renamed', state: 'offline' });
    await collapseFleet(page);
    await add.click();
    await expect(
      fleetView(page).getByTestId('add-machine-panel')
    ).toBeVisible();
    await collapseFleet(page);
    beam!.peerChanged({ peerId: 'b'.repeat(32), label: 'newbox' });
    await openFleet(desktop);
    await expect(fleetView(page).getByTestId('add-machine-panel')).toHaveCount(
      0
    );
    await expect(
      page.getByTestId('machine-row').filter({ hasText: 'newbox' })
    ).toBeVisible();
    await expect(
      fleetView(page).getByRole('button', { name: 'Done' })
    ).toHaveCount(0);
  });
});

test.describe('Joining a fleet', () => {
  test.use({ beamScenario: { enrolled: false } });

  test('asks for the fingerprint check, and keeps it until answered', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await finishJoin(page, beam!);
    const view = fleetView(page);
    await expect(
      view.getByRole('heading', { name: 'Check fleet fingerprint' })
    ).toBeVisible();
    await expect(view.getByRole('button', { name: 'Close' })).toHaveCount(0);

    await collapseFleet(page);
    await openFleet(desktop);
    await view.getByRole('button', { name: 'Matches' }).click();
    await expect(
      view.getByRole('heading', { name: 'Check fleet fingerprint' })
    ).toHaveCount(0);
  });

  test('a mismatch says to stop and offers only the reset', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await finishJoin(page, beam!);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Doesn’t match' }).click();
    await expect(
      view.getByRole('heading', { name: 'Different fleet' })
    ).toBeVisible();
    await expect(
      view.getByText(/Stop using remote connections\./)
    ).toBeVisible();
    await view
      .getByRole('alert')
      .getByRole('button', { name: 'Reset fleet…' })
      .click();
    await expect(
      view.getByRole('heading', {
        name: 'Reset fleet here?',
      })
    ).toBeVisible();
    expect(beam!.ops('fleet.reset')).toHaveLength(0);
  });
});

test.describe('A pending directory write', () => {
  test.use({ beamScenario: { enrolled: false } });

  test('stays in Fleet after its card closes, until its event', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await finishCreatePending(page, beam!);
    const view = fleetView(page);
    const pending = view.getByText('Saved here. Waiting to sync…');
    await expect(pending).toBeVisible();

    await expect(view.getByRole('button', { name: 'Close' })).toHaveCount(0);
    await expect(pending).toBeVisible();
    beam!.published('member', SELF_PEER_ID);
    await expect(pending).toHaveCount(0);
  });

  test('updates the result still on screen', async ({ desktop, beam }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await finishCreatePending(page, beam!);
    const view = fleetView(page);
    await expect(view.getByText(/Waiting to sync/)).toBeVisible();
    beam!.published('member', SELF_PEER_ID);
    await expect(view.getByText(/Waiting to sync/)).toHaveCount(0);
  });
});

test.describe('beam still starting', () => {
  test.use({ beamScenario: { enrolled: false, started: false } });

  test('says it is preparing the network, with nothing to start yet', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    const notice = view.getByText('Starting Fleet…');
    await expect(notice).toBeVisible();
    await expect(
      view.getByRole('button', { name: 'Create a fleet' })
    ).toHaveCount(0);
    beam!.setStarted();
    await expect(notice).toHaveCount(0);
    await expect(
      view.getByRole('button', { name: 'Create a fleet' })
    ).toBeVisible();
  });
});
