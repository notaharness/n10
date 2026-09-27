import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';
import { fleetView } from './setup/machines.js';

const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Fleet ${theme} @visual`, () => {
    test.use({
      repo: { name: 'n10-visual' },
      desktopPrefs: { theme, nativeFrame: false },
    });

    test.describe('first run', () => {
      test.use({ beamScenario: { enrolled: false } });
      test('choices, create and failure', async ({ desktop, beam }) => {
        const { page } = desktop;
        const fleet = fleetView(page);
        await expect(
          fleet.getByRole('button', { name: 'Create a fleet' })
        ).toBeVisible();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-first-run-${theme}.png`,
          shot
        );
        await fleet.getByRole('button', { name: 'Create a fleet' }).click();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-create-${theme}.png`,
          shot
        );
        await fleet.getByRole('button', { name: 'Create fleet' }).click();
        await expect(fleet.getByTestId('ceremony-url')).toBeVisible();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-passkey-${theme}.png`,
          shot
        );
        beam!.failCeremony('prf-unsupported', 'no prf.results.first');
        await expect(fleet.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-error-${theme}.png`,
          shot
        );
      });
    });

    test.describe('enrolled', () => {
      test.use({
        beamScenario: {
          enrolled: true,
          peers: [{ peerId: WORKBOX, label: 'workbox', state: 'offline' }],
        },
      });
      test('overview and add machine', async ({ desktop }) => {
        const { page } = desktop;
        await expect(page.getByTestId('machine-row')).toHaveCount(2);
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-overview-${theme}.png`,
          shot
        );
        await page
          .getByRole('button', { name: 'Add a machine', exact: true })
          .click();
        await expect(
          fleetView(page).getByText('beam join --label buildbox')
        ).toBeVisible();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-add-${theme}.png`,
          shot
        );
        await page.getByRole('button', { name: 'Close instructions' }).click();
        await fleetView(page)
          .getByRole('button', { name: 'Reset fleet…' })
          .click();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-reset-${theme}.png`,
          shot
        );
        await fleetView(page).getByRole('button', { name: 'Cancel' }).click();
        await page
          .getByTestId('machine-row')
          .filter({ hasText: 'workbox' })
          .getByRole('button', { name: 'Machine actions' })
          .click();
        await page.getByRole('menuitem', { name: 'Revoke workbox…' }).click();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-revoke-${theme}.png`,
          shot
        );
      });
    });
  });
}
