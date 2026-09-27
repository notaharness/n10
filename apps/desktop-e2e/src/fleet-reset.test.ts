import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';
import { fleetView, openFleet } from './setup/machines.js';

/**
 * Resetting this machine's fleet (beam-fleet-ux.md §3): an explicit,
 * typed confirmation that calls beam's `fleet.reset`, and nothing else.
 */

test.describe('Reset fleet on this machine', () => {
  test.use({
    beamScenario: {
      enrolled: true,
      peers: [{ peerId: WORKBOX, label: 'workbox' }],
    },
  });

  test('needs reset typed exactly, and can be cancelled', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await fleetView(page).getByRole('button', { name: 'Reset fleet…' }).click();
    const panel = fleetView(page);
    await expect(
      panel.getByRole('heading', { name: 'Reset fleet here?' })
    ).toBeVisible();
    await expect(
      panel.getByText(/Other machines and your passkey stay unchanged\./)
    ).toBeVisible();
    const confirm = panel.getByLabel('Type reset to confirm');
    const reset = panel.getByRole('button', { name: 'Reset fleet' });
    await expect(reset).toBeDisabled();
    await confirm.fill('Reset');
    await expect(reset).toBeDisabled();
    await confirm.fill('reset ');
    await expect(reset).toBeDisabled();

    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      panel.getByRole('heading', { name: 'Reset fleet here?' })
    ).toHaveCount(0);
    expect(beam!.ops('fleet.reset')).toHaveLength(0);
    await expect(page.getByTestId('machine-row')).toHaveCount(2);
  });

  test('resets through beam, then offers to create or join', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    await fleetView(page).getByRole('button', { name: 'Reset fleet…' }).click();
    const panel = fleetView(page);
    await panel.getByLabel('Type reset to confirm').fill('reset');
    await panel.getByLabel('Type reset to confirm').press('Enter');

    await expect(
      panel.getByRole('button', { name: 'Create a fleet' })
    ).toBeVisible();
    expect(beam!.ops('fleet.reset')).toEqual([
      expect.objectContaining({ confirm: 'reset' }),
    ]);
    await expect(
      fleetView(page).getByRole('heading', {
        name: 'Your machines, together',
      })
    ).toBeVisible();
    await expect(page.getByTestId('machine-row')).toHaveCount(0);
  });

  test('a refused reset keeps the confirmation and says why', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    beam!.refuse('fleet.reset', 'storage-failure', 'disk full');
    await openFleet(desktop);
    await fleetView(page).getByRole('button', { name: 'Reset fleet…' }).click();
    const panel = fleetView(page);
    await panel.getByLabel('Type reset to confirm').fill('reset');
    await panel.getByRole('button', { name: 'Reset fleet' }).click();
    await expect(
      panel.getByText(
        'Couldn’t reset fleet. Couldn’t save. Check disk space and permissions.'
      )
    ).toBeVisible();
    await expect(panel.getByLabel('Type reset to confirm')).toHaveValue(
      'reset'
    );
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('machine-row')).toHaveCount(2);
  });
});

test.describe('after creating a fleet', () => {
  test.use({ beamScenario: { enrolled: false } });

  test('a reset clears the creation’s result', async ({ desktop, beam }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Create a fleet' }).click();
    await view.getByRole('button', { name: 'Create fleet' }).click();
    await expect(view.getByTestId('ceremony-url')).toBeVisible();
    beam!.nextPasskeyStep();
    beam!.finishCeremony();
    await expect(view.getByTestId('fleet-fingerprint')).toBeVisible();

    await view.getByRole('button', { name: 'Reset fleet…' }).click();
    const panel = fleetView(page);
    await panel.getByLabel('Type reset to confirm').fill('reset');
    await panel.getByRole('button', { name: 'Reset fleet' }).click();
    await expect(
      view.getByRole('heading', { name: 'Your machines, together' })
    ).toBeVisible();
    await expect(
      view.getByRole('heading', { name: 'Fleet created' })
    ).toHaveCount(0);
  });
});
