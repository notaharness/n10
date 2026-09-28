import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';
import { fleetView, openFleet } from './setup/machines.js';

/**
 * The guided first run and the passkey steps (beam-fleet-ux.md §2–§4),
 * over a scripted daemon that a test walks through each signal.
 */

async function startCreate(page: Page, label = 'laptop', fleet = 'home') {
  const view = fleetView(page);
  await view.getByRole('button', { name: 'Create a fleet' }).click();
  await view.getByLabel('Machine name').fill(label);
  await view.getByLabel('Fleet name').fill(fleet);
  await view.getByRole('button', { name: 'Create fleet' }).click();
}

function step(page: Page, name: string) {
  return fleetView(page).getByRole('listitem').filter({ hasText: name });
}

test.describe('First run', () => {
  test.use({ beamScenario: { enrolled: false } });

  test('More information opens beam’s site in the browser, not the window', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      Object.assign(globalThis, { openedUrls: opened });
      shell.openExternal = async (url) => {
        opened.push(url);
      };
    });
    await openFleet(desktop);
    const windowUrl = page.url();
    await fleetView(page)
      .getByRole('link', { name: 'More information' })
      .click();
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as { openedUrls?: string[] }).openedUrls)
      )
      .toEqual(['https://beam.n10.is']);
    expect(page.url()).toBe(windowUrl);
    await expect(
      fleetView(page).getByRole('img', { name: 'Tailscale' })
    ).toBeVisible();
  });

  test('the beam illustration holds still under reduced motion', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const packet = fleetView(page).locator('.fleet-art-packet').first();
    const playState = () =>
      packet.evaluate((el) => getComputedStyle(el).animationPlayState);
    await expect.poll(playState).toBe('running');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(playState).toBe('paused');
  });

  test('creates a fleet through both passkey steps, each with its own link', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Create a fleet' }).click();
    await expect(
      view.getByRole('heading', { name: 'Create a fleet' })
    ).toBeVisible();
    await expect(view.getByLabel('Machine name')).toHaveAttribute(
      'placeholder',
      'Host name'
    );
    await expect(
      view.getByText('Shown in your passkey manager.')
    ).toBeVisible();
    await expect(
      view.getByText('Save a passkey, then use it to add this machine.')
    ).toBeVisible();
    await expect(
      view.getByRole('button', { name: 'Passkey help' })
    ).toBeVisible();

    await view.getByLabel('Machine name').fill('laptop');
    await view.getByLabel('Fleet name').fill('home');
    await view.getByRole('button', { name: 'Create fleet' }).dblclick();

    await expect(
      view.getByRole('heading', {
        name: '1 of 2 · Save a passkey',
      })
    ).toBeVisible();
    expect(beam!.ops('init.start')).toHaveLength(1);
    expect(beam!.ops('init.start')[0]).toMatchObject({
      label: 'laptop',
      fleetName: 'home',
    });
    const first = beam!.currentUrl;
    await expect(view.getByTestId('ceremony-url')).toHaveText(first);
    await expect(
      view.getByText('Create fleet passkey for “home”')
    ).toBeVisible();
    await expect(view.getByRole('img', { name: /QR code/ })).toBeVisible();
    await expect(step(page, 'Save a passkey')).toHaveAttribute(
      'aria-current',
      'step'
    );

    const second = beam!.nextPasskeyStep();
    await expect(
      view.getByRole('heading', {
        name: '2 of 2 · Add this machine',
      })
    ).toBeVisible();
    await expect(view.getByTestId('ceremony-url')).toHaveText(second);
    await expect(view.getByText(first)).toHaveCount(0);
    await expect(view.getByText('Add “laptop” to fleet')).toBeVisible();
    await expect(step(page, 'Save a passkey')).toContainText('(done)');

    beam!.stage('publishing');
    await expect(
      view.getByRole('heading', { name: 'Finishing setup…' })
    ).toBeVisible();
    await expect(view.getByTestId('ceremony-url')).toHaveCount(0);
    await expect(view.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

    beam!.finishCeremony();
    await expect(page.getByTestId('machine-row')).toHaveCount(1);
    await expect(view.getByTestId('ceremony-url')).toHaveCount(0);
    await expect(view.getByRole('button', { name: 'Close' })).toHaveCount(0);
  });

  test('refuses a name beam would refuse, without rewriting it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Create a fleet' }).click();
    await view.getByLabel('Fleet name').fill('home/office');
    await expect(
      view.getByText(
        'Use up to 64 characters; no /, \\, braces or control characters.'
      )
    ).toBeVisible();
    await expect(
      view.getByRole('button', { name: 'Create fleet' })
    ).toBeDisabled();
    await expect(view.getByLabel('Fleet name')).toHaveValue('home/office');
  });

  test('cancelling step 2 never marks it done; Try again starts afresh, Back keeps the names', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await startCreate(page);
    await expect(view.getByTestId('ceremony-url')).toBeVisible();
    beam!.nextPasskeyStep();
    await expect(
      view.getByRole('heading', {
        name: '2 of 2 · Add this machine',
      })
    ).toBeVisible();

    await view.getByRole('button', { name: 'Cancel' }).click();
    await expect(view.getByText('Passkey request cancelled.')).toBeVisible();
    expect(beam!.ops('ceremony.cancel')).toHaveLength(1);
    await expect(step(page, 'Add this machine')).toContainText('(stopped)');
    await expect(view.getByText(/A passkey may have been saved/)).toBeVisible();
    await view.getByText('Details', { exact: true }).click();
    await expect(
      view.locator('code', { hasText: 'ceremony-cancelled' })
    ).toBeVisible();
    await expect(view.getByTestId('ceremony-url')).toHaveCount(0);

    await view.getByRole('button', { name: 'Try again' }).click();
    await expect(
      view.getByRole('heading', {
        name: '1 of 2 · Save a passkey',
      })
    ).toBeVisible();
    expect(beam!.ops('init.start')).toHaveLength(2);

    beam!.failCeremony('ceremony-timeout');
    await expect(view.getByText(/Request expired/)).toBeVisible();
    await expect(
      view.getByRole('button', { name: 'Back', exact: true })
    ).toHaveCount(0);
    await view.getByRole('button', { name: 'Close' }).click();
    await view.getByRole('button', { name: 'Create a fleet' }).click();
    await expect(view.getByLabel('Machine name')).toHaveValue('laptop');
    await expect(view.getByLabel('Fleet name')).toHaveValue('home');
  });

  test('a PRF failure opens the compatibility help; beam’s detail shows as text', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await view.getByRole('button', { name: 'Join a fleet' }).click();
    await expect(view.getByText('Use your fleet’s passkey.')).toBeVisible();
    await expect(view.getByLabel('Fleet name')).toHaveCount(0);
    await view.getByRole('button', { name: 'Join fleet' }).click();
    await expect(
      view.getByRole('heading', { name: 'Add this machine' })
    ).toBeVisible();
    await expect(
      view.getByText('Use your fleet’s existing passkey.')
    ).toBeVisible();

    beam!.failCeremony('prf-unsupported', '<b>no prf.results.first</b>');
    await expect(view.getByText(/This passkey isn’t supported/)).toBeVisible();
    await view.getByText('Details', { exact: true }).click();
    await expect(view.getByText('<b>no prf.results.first</b>')).toBeVisible();
    await expect(
      view.getByText(
        'Use the same fleet passkey. A new one creates a different fleet.'
      )
    ).toBeVisible();
    await expect(
      view.getByText(/Update your browser and passkey manager/)
    ).toBeVisible();
    await view.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(
      view.getByRole('heading', { name: 'Join a fleet' })
    ).toBeVisible();
  });

  test('another client’s ceremony: back, never retry', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const view = fleetView(page);
    await startCreate(page);
    await expect(view.getByTestId('ceremony-url')).toBeVisible();
    beam!.failCeremony('busy');
    await expect(view.getByText(/Another request is open/)).toBeVisible();
    await expect(view.getByRole('button', { name: 'Try again' })).toHaveCount(
      0
    );
    await view.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(
      view.getByRole('heading', { name: 'Create a fleet' })
    ).toBeVisible();
  });
});

test.describe('Revoking a member', () => {
  test.use({
    beamScenario: {
      enrolled: true,
      peers: [{ peerId: WORKBOX, label: 'workbox' }],
    },
  });

  test('asks for the passkey, shows what it removes, and reports the outcome', async ({
    desktop,
    beam,
  }) => {
    const { page } = desktop;
    await openFleet(desktop);
    const row = page.locator(`[data-peer-id="${WORKBOX}"]`);
    await row.getByRole('button', { name: 'Machine actions' }).click();
    await page.getByRole('menuitem', { name: 'Revoke workbox…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('c0ff ee00 c0ff ee00')).toBeVisible();
    await expect(
      dialog.getByText(/^Permanently revoke workbox’s access\./)
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Revoke access' }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Confirm with your passkey' })
    ).toBeVisible();
    await expect(dialog.getByText('Remove “workbox” from fleet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    beam!.failCeremony('bad-assertion');
    await expect(dialog.getByText(/Couldn’t verify the passkey/)).toBeVisible();
    // The result takes focus, not the dialog it replaced a step inside.
    await expect(dialog.getByRole('alert')).toBeFocused();
    await dialog.getByRole('button', { name: 'Try again' }).click();
    await expect(dialog.getByTestId('ceremony-url')).toBeVisible();
    expect(beam!.ops('revoke.start')).toHaveLength(2);

    beam!.stage('notifying peers');
    await expect(
      dialog.getByRole('heading', { name: 'Updating machines…' })
    ).toBeVisible();
    await expect(dialog.getByTestId('ceremony-url')).toHaveCount(0);

    beam!.finishCeremony();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByText('Revoked', { exact: true })).toBeVisible();
  });
});
