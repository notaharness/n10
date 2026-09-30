import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { tab } from './setup/app.js';
import type { FakeAzureDevOps } from './setup/fake-ado.js';
import { clickAppMenuItem } from './setup/menu.js';

const PAT = 'ado_e2e_super_secret_value';
const ROTATED = 'ado_rotated';
const PLACEHOLDER = '••••••••';

/** An Azure DevOps project with no pull requests, whose token the app
 *  holds as `PAT`. Selecting the vendor is what puts its auth fields in
 *  the settings model, and the vendor is per-project config the fake
 *  writes. */
const AZURE: FakeAzureDevOps = {
  pat: PAT,
  user: { displayName: 'n10 tester', uniqueName: 'n10-tester@example.com' },
  prs: [],
};

function storedPat(homeDir: string): string | undefined {
  const raw = readFileSync(join(homeDir, '.n10', 'config.json'), 'utf8');
  const parsed = JSON.parse(raw) as {
    vendorAuth?: Record<string, Record<string, string>>;
  };
  return parsed.vendorAuth?.['azure-devops']?.pat;
}

test.describe('Settings', () => {
  test.use({
    fakeAzureDevOps: AZURE,
    n10Config: {
      // Long enough that nothing in these tests can be explained by a
      // poll happening to fire: a refetch inside them is one something
      // asked for.
      prPollInterval: 3_600_000,
      mergePollInterval: 3_600_000,
    },
  });

  test('a stored secret never reaches the renderer', async ({ desktop }) => {
    const { page, homeDir } = desktop;
    expect(storedPat(homeDir)).toBe(PAT);

    const view = await page.evaluate(() => window.n10.getSettingsView());
    const masked = view.filter((f) => f.masked);
    expect(masked.length).toBeGreaterThan(0);

    // The whole payload, not just the field: the renderer displays
    // provider-hosted markdown and images, so a secret anywhere in its
    // memory is one script-execution foothold from being read.
    expect(JSON.stringify(view)).not.toContain(PAT);
    for (const field of masked) {
      expect(field.value).toBe(PLACEHOLDER);
    }
  });

  test('saving an untouched secret field keeps the real credential', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;

    // Exactly what the form does when the user saves a field they never
    // edited: it sends back the placeholder it was given.
    await page.evaluate(async (placeholder) => {
      const view = await window.n10.getSettingsView();
      const field = view.find((f) => f.masked);
      if (!field) throw new Error('no masked field in the settings view');
      await window.n10.updateSettingsField(
        { label: field.label, key: field.key },
        placeholder
      );
    }, PLACEHOLDER);

    expect(storedPat(homeDir)).toBe(PAT);
  });

  test('a real edit replaces the secret', async ({ desktop }) => {
    const { page, homeDir } = desktop;

    await page.evaluate(async (rotated) => {
      const view = await window.n10.getSettingsView();
      const field = view.find((f) => f.masked);
      if (!field) throw new Error('no masked field in the settings view');
      await window.n10.updateSettingsField(
        { label: field.label, key: field.key },
        rotated
      );
    }, ROTATED);

    expect(storedPat(homeDir)).toBe(ROTATED);
  });

  test.describe('with a revoked token', () => {
    // Azure takes only the replacement: the launch fetch is refused as
    // a revoked token is, 401.
    test.use({ fakeAzureDevOps: { ...AZURE, acceptedPat: ROTATED } });

    /**
     * Replacing a rejected access token has to take effect now.
     *
     * `remoteFetches` is monotonic, and with the poll interval set to
     * an hour nothing else in the test can move it, so a fetch counted
     * straight after the save is one the save started.
     */
    test('saving a token refetches immediately instead of waiting for the poll', async ({
      desktop,
    }) => {
      const { page } = desktop;
      const syncState = () => page.evaluate(() => window.n10.getSyncState());

      // Let the launch fetch finish and record a failure, so there is a
      // stale error to clear.
      await expect
        .poll(async () => (await syncState()).remoteError, {
          timeout: 20_000,
        })
        .not.toBeNull();
      const before = (await syncState()).remoteFetches;

      const after = await page.evaluate(async (rotated) => {
        const view = await window.n10.getSettingsView();
        const field = view.find((f) => f.masked);
        if (!field) throw new Error('no masked field in the settings view');
        await window.n10.updateSettingsField(
          { label: field.label, key: field.key },
          rotated
        );
        // Read straight after the save, before the fetch it started
        // has had time to land.
        return window.n10.getSyncState();
      }, ROTATED);

      expect(after.remoteFetches).toBeGreaterThan(before);
      // A poll is an hour away, so the fetch above came from the write.
      expect(after.remoteIntervalMs).toBe(3_600_000);
      // And it went out with the new token, which Azure takes.
      await expect.poll(async () => (await syncState()).remoteError).toBeNull();
    });
  });

  test('the settings page renders the secret as dots', async ({ desktop }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();

    await page.getByRole('button', { name: 'Provider' }).click();
    const secretInput = page.locator('input[type="password"]').first();
    await expect(secretInput).toHaveValue(PLACEHOLDER);
  });
});
