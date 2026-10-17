import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/fake-beam.js';
import { WORKBOX } from './setup/fake-beam.js';

const OTHER = 'b'.repeat(32);

async function openRevoke(page: Page, peerId: string) {
  await page
    .locator(`[data-peer-id="${peerId}"]`)
    .getByRole('button', { name: 'Machine actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Revoke access…' }).click();
}

test.use({
  beamScenario: {
    enrolled: true,
    peers: [
      { peerId: WORKBOX, label: 'workbox' },
      { peerId: OTHER, label: 'otherbox' },
    ],
  },
});

test('another revoke resumes the running target through cancellation, retry and completion', async ({
  desktop,
  beam,
}) => {
  const { page } = desktop;
  await openRevoke(page, WORKBOX);
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', { name: 'Revoke access', exact: true })
    .click();
  await expect(dialog.getByTestId('ceremony-url')).toBeVisible();
  const firstUrl = beam!.currentUrl;
  await dialog.getByRole('button', { name: 'Keep working' }).click();

  await openRevoke(page, OTHER);
  await expect(dialog.getByTestId('ceremony-url')).toHaveText(firstUrl);
  await expect(dialog).toHaveAccessibleName('Revoke access to workbox?');
  await expect(dialog.getByText('Remove “workbox” from fleet')).toBeVisible();
  await expect(dialog.getByRole('img', { name: /QR code/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel request' }).click();
  await expect(dialog.getByText(/Passkey request cancelled/)).toBeVisible();
  expect(beam!.ops('ceremony.cancel')).toHaveLength(1);

  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByTestId('ceremony-url')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep working' }).click();
  await openRevoke(page, OTHER);
  await expect(dialog.getByTestId('ceremony-url')).toHaveText(beam!.currentUrl);
  beam!.stage('notifying peers');
  await expect(
    dialog.getByRole('heading', { name: 'Updating machines…' })
  ).toBeVisible();
  beam!.failCeremony('bad-assertion');
  await expect(dialog.getByRole('alert')).toContainText(
    'Couldn’t verify the passkey.'
  );
  await expect(dialog).toHaveAccessibleName('Revoke access to workbox?');
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByTestId('ceremony-url')).toBeVisible();
  expect(beam!.ops('revoke.start').map((request) => request.peer)).toEqual([
    WORKBOX,
    WORKBOX,
    WORKBOX,
  ]);

  beam!.finishCeremony();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText('Access to workbox revoked here.', { exact: true })
  ).toBeVisible();
  await expect(
    page
      .locator(`[data-peer-id="${OTHER}"]`)
      .getByText('Revoked', { exact: true })
  ).toHaveCount(0);
  await openRevoke(page, OTHER);
  await expect(
    dialog.getByRole('heading', { name: 'Revoke access to otherbox?' })
  ).toBeVisible();
});
