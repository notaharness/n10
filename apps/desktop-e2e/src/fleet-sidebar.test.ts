import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';
import { tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';
import {
  collapseFleet,
  fleetToggle,
  fleetView,
  openFleet,
} from './setup/machines.js';

/**
 * Fleet lives in the sidebar (beam-fleet-ux.md §1): a section of the
 * workspace's sidebar and of the repository picker's, never a page of
 * its own. Its flows run beside the workspace, and survive collapsing
 * the section, hiding the sidebar and switching repositories.
 */

test.describe('Fleet in the sidebar', () => {
  test.use({ beamScenario: { enrolled: false } });

  test.describe('before a repository is open', () => {
    test.use({ startWithoutRepo: true });

    test('sits beside the repository picker', async ({ desktop }) => {
      const { page } = desktop;
      await expect(fleetToggle(page)).toContainText('Not set up');
      await openFleet(desktop);
      await expect(
        fleetView(page).getByRole('heading', {
          name: 'Your machines, connected anywhere',
        })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Open repository…' })
      ).toBeVisible();
    });
  });

  test('starts expanded, and remembers a collapse', async ({ desktop }) => {
    const { page } = desktop;
    await expect(fleetToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(fleetView(page)).toBeVisible();
    await collapseFleet(page);
    await page.reload();
    await expect(fleetToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(fleetView(page)).toHaveCount(0);
  });

  test('a running ceremony leaves the workspace usable', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const fleet = fleetView(page);
    await fleet.getByRole('button', { name: 'Create a fleet' }).click();
    await fleet.getByRole('button', { name: 'Create fleet' }).click();
    await expect(fleet.getByTestId('ceremony-url')).toBeVisible();

    await expect(page.getByTestId('workspace-screen')).toBeVisible();
    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(beam!.ops('ceremony.cancel')).toHaveLength(0);
  });

  test('keeps the form and a running ceremony across collapsing and hiding', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const fleet = fleetView(page);
    await fleet.getByRole('button', { name: 'Create a fleet' }).click();
    await fleet.getByLabel('Machine name').fill('laptop');
    await collapseFleet(page);
    await openFleet(desktop);
    await expect(fleet.getByLabel('Machine name')).toHaveValue('laptop');
    await fleet.getByRole('button', { name: 'Create fleet' }).click();
    await expect(fleet.getByTestId('ceremony-url')).toBeVisible();

    await collapseFleet(page);
    // Collapsed, the header still says a passkey step is waiting.
    await expect(fleetToggle(page)).toContainText('Passkey step');
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await clickAppMenuItem(desktop.app, 'Toggle Sidebar');
    await openFleet(desktop);
    await expect(fleet.getByTestId('ceremony-url')).toHaveText(
      beam!.currentUrl
    );
    expect(beam!.ops('init.start')).toHaveLength(1);
    expect(beam!.ops('ceremony.cancel')).toHaveLength(0);
  });

  test('a remounted step leaves focus where the user put it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const fleet = fleetView(page);
    await fleet.getByRole('button', { name: 'Create a fleet' }).click();
    await fleet.getByRole('button', { name: 'Create fleet' }).click();
    const step = fleet.getByRole('heading', {
      name: '1 of 2 · Save a passkey',
    });
    // A real step transition takes focus: the clicked button is gone.
    await expect(step).toBeFocused();

    // Showing the sidebar again remounts the step under other focus.
    const search = page
      .getByRole('banner')
      .getByRole('button', { name: /Search branches/ });
    await search.focus();
    await clickAppMenuItem(desktop.app, 'Toggle Sidebar');
    await clickAppMenuItem(desktop.app, 'Toggle Sidebar');
    await expect(step).toBeVisible();
    await expect(search).toBeFocused();

    // So does expanding the section, whose header keeps focus.
    await collapseFleet(page);
    await fleetToggle(page).click();
    await expect(step).toBeVisible();
    await expect(fleetToggle(page)).toBeFocused();

    // And a repository switch, where focus has nowhere left to be.
    await clickAppMenuItem(desktop.app, 'Switch Repository…');
    await expect(step).toBeVisible();
    await expect(step).not.toBeFocused();
  });

  test('Settings links to the section instead of enrolling there', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();
    await page.getByRole('button', { name: 'Machines', exact: true }).click();
    await expect(
      page.getByText(
        'Manage your machines, passkeys and fleet recovery in the sidebar’s Fleet section.'
      )
    ).toBeVisible();
    // The sidebar's own, and no second one in Settings.
    await expect(
      page.getByRole('button', { name: 'Create a fleet' })
    ).toHaveCount(1);
    await expect(
      fleetView(page).getByRole('button', { name: 'Create a fleet' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await page.getByRole('button', { name: 'Show Fleet' }).click();
    await expect(fleetView(page)).toBeVisible();
    await expect(fleetToggle(page)).toBeFocused();
  });

  test.describe('with a member', () => {
    test.use({
      beamScenario: {
        enrolled: true,
        peers: [{ peerId: WORKBOX, label: 'workbox' }],
      },
    });

    test('the status bar reveals the section in a hidden sidebar', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await expect(fleetToggle(page)).toContainText('2 machines');
      await page.getByRole('button', { name: 'Hide sidebar' }).click();
      await expect(page.getByRole('complementary')).toHaveCount(0);
      await page
        .getByRole('contentinfo')
        .getByRole('button', { name: '2 machines' })
        .click();
      await expect(
        fleetView(page)
          .getByTestId('machine-row')
          .filter({ hasText: 'workbox' })
      ).toBeVisible();
    });

    test('a revocation waiting on its passkey outlives switching repositories', async ({
      desktop,
      beam,
    }) => {
      const { page } = desktop;
      await openFleet(desktop);
      const row = page
        .getByTestId('machine-row')
        .filter({ hasText: 'workbox' });
      await row.getByRole('button', { name: 'Machine actions' }).click();
      await page.getByRole('menuitem', { name: 'Revoke workbox…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Revoke access' }).click();
      await expect(dialog.getByTestId('ceremony-url')).toHaveText(
        beam!.currentUrl
      );

      await clickAppMenuItem(desktop.app, 'Switch Repository…');
      await expect(page.getByTestId('workspace-screen')).toHaveCount(0);
      await expect(dialog.getByTestId('ceremony-url')).toHaveText(
        beam!.currentUrl
      );
      expect(beam!.ops('ceremony.cancel')).toHaveLength(0);
    });
  });
});
