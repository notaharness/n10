import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';
import { chooseFleetAction, fleetView } from './setup/machines.js';

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
        await fleet.getByText('About Fleet', { exact: true }).click();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-help-${theme}.png`,
          shot
        );
        await fleet.getByText('About Fleet', { exact: true }).click();
        await fleet.getByRole('button', { name: 'Create a fleet' }).click();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-create-${theme}.png`,
          shot
        );
        await fleet.getByRole('button', { name: 'Continue' }).click();
        await expect(fleet.getByTestId('ceremony-url')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-passkey-${theme}.png`,
          shot
        );
        await page.getByRole('button', { name: 'Keep working' }).click();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-resume-${theme}.png`,
          shot
        );
        beam!.nextPasskeyStep();
        await page.getByRole('button', { name: 'Resume passkey step' }).click();
        await expect(
          page.getByRole('heading', { name: '2 of 2 · Add this machine' })
        ).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-authorize-${theme}.png`,
          shot
        );
        beam!.failCeremony('prf-unsupported', 'no prf.results.first');
        await expect(fleet.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-error-${theme}.png`,
          shot
        );
        await page.getByRole('button', { name: 'Start again' }).click();
        await expect(page.getByTestId('ceremony-url')).toBeVisible();
        beam!.nextPasskeyStep();
        beam!.finishCeremony();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-created-${theme}.png`,
          shot
        );
      });
    });

    test.describe('join', () => {
      test.use({ beamScenario: { enrolled: false } });
      test('join, comparison and mismatch', async ({ desktop, beam }) => {
        const { page } = desktop;
        await fleetView(page)
          .getByRole('button', { name: 'Join a fleet' })
          .click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toHaveScreenshot(`fleet-join-${theme}.png`, shot);
        await dialog.getByRole('button', { name: 'Continue' }).click();
        await expect(dialog.getByTestId('ceremony-url')).toBeVisible();
        await expect(dialog).toHaveScreenshot(
          `fleet-join-passkey-${theme}.png`,
          shot
        );
        beam!.failCeremony('prf-unsupported', 'no prf.results.first');
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(dialog).toHaveScreenshot(
          `fleet-join-error-${theme}.png`,
          shot
        );
        await dialog.getByRole('button', { name: 'Try again' }).click();
        await expect(dialog.getByTestId('ceremony-url')).toBeVisible();
        beam!.stage('reading directory');
        await expect(
          dialog.getByRole('heading', { name: 'Finding machines…' })
        ).toBeVisible();
        await expect(dialog).toHaveScreenshot(
          `fleet-finding-${theme}.png`,
          shot
        );
        beam!.stage('publishing');
        await expect(
          dialog.getByRole('heading', { name: 'Publishing the fleet update…' })
        ).toBeVisible();
        await expect(dialog).toHaveScreenshot(
          `fleet-finishing-${theme}.png`,
          shot
        );
        beam!.finishCeremony('pending');
        await expect(
          dialog.getByRole('button', { name: 'Matches', exact: true })
        ).toBeVisible();
        await expect(dialog).toHaveScreenshot(`fleet-check-${theme}.png`, shot);
        await dialog.getByRole('button', { name: 'Check later' }).click();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-unchecked-${theme}.png`,
          shot
        );
        await page.getByRole('button', { name: 'Compare fingerprint' }).click();
        await dialog.getByRole('button', { name: 'Doesn’t match' }).click();
        await expect(dialog).toHaveScreenshot(
          `fleet-mismatch-${theme}.png`,
          shot
        );
        await dialog
          .getByRole('button', { name: 'Close', exact: true })
          .click();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-pending-${theme}.png`,
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
      test('overview and add machine', async ({ desktop, beam }) => {
        const { page } = desktop;
        await expect(page.getByTestId('machine-row')).toHaveCount(2);
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-overview-${theme}.png`,
          shot
        );
        // The menu renders in a portal outside the sidebar, and opening
        // it hides the sidebar from the accessibility tree: measure first.
        const sidebar = (await page.getByRole('complementary').boundingBox())!;
        await page
          .getByRole('complementary')
          .getByRole('button', { name: 'Fleet actions' })
          .click();
        await expect(
          page.getByRole('menuitem', { name: 'Reset fleet…' })
        ).toBeVisible();
        await expect(page).toHaveScreenshot(`fleet-actions-${theme}.png`, {
          ...shot,
          clip: {
            ...sidebar,
            y: sidebar.y + sidebar.height - 220,
            height: 220,
          },
        });
        await page.keyboard.press('Escape');
        await page
          .getByRole('button', { name: 'Add a machine', exact: true })
          .click();
        await expect(
          fleetView(page).getByText('beam join --label my-server')
        ).toBeVisible();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-add-${theme}.png`,
          shot
        );
        await page.getByRole('button', { name: 'Close instructions' }).click();
        await chooseFleetAction(page, 'Reset fleet…');
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-reset-${theme}.png`,
          shot
        );
        await fleetView(page).getByLabel('Type reset to confirm').fill('reset');
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-reset-confirmed-${theme}.png`,
          shot
        );
        beam!.refuse('fleet.reset', 'storage-failure', 'disk full');
        await fleetView(page)
          .getByRole('button', { name: 'Reset fleet', exact: true })
          .click();
        await expect(fleetView(page).getByRole('alert')).toBeVisible();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-reset-error-${theme}.png`,
          shot
        );
        await fleetView(page).getByRole('button', { name: 'Cancel' }).click();
        await page
          .getByTestId('machine-row')
          .filter({ hasText: 'workbox' })
          .getByRole('button', { name: 'Machine actions' })
          .click();
        await page.getByRole('menuitem', { name: 'Revoke access…' }).click();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-revoke-${theme}.png`,
          shot
        );
        await page
          .getByRole('button', { name: 'Revoke access', exact: true })
          .click();
        await expect(page.getByTestId('ceremony-url')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-revoke-passkey-${theme}.png`,
          shot
        );
        beam!.failCeremony('prf-unsupported', 'no prf.results.first');
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-revoke-error-${theme}.png`,
          shot
        );
        await page.getByRole('button', { name: 'Try again' }).click();
        await expect(page.getByTestId('ceremony-url')).toBeVisible();
        beam!.stage('notifying peers');
        await expect(
          page.getByRole('heading', { name: 'Updating machines…' })
        ).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveScreenshot(
          `fleet-updating-${theme}.png`,
          shot
        );
        beam!.finishCeremony('pending');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-revoke-pending-${theme}.png`,
          shot
        );
        beam!.published('revoke', WORKBOX);
        await expect(
          page.getByText('Published', { exact: true })
        ).toBeVisible();
        await expect(page.getByRole('complementary')).toHaveScreenshot(
          `fleet-revoked-${theme}.png`,
          shot
        );
      });
    });
  });
}
