import { test, expect } from './fixtures/desktop.js';
import { takeNetworkRefusals } from './setup/network-guard.js';

/**
 * The suite is offline: whatever gets past the fakes to a provider's
 * servers is refused and fails the test (`fixtures/network-guard.cjs`).
 * Here each process that could make such a request makes one, and the
 * test takes the refusals so that they do not fail it.
 */

test.describe('Network guard', () => {
  test.use({
    // Azure DevOps configured for real, with no fake to answer it: the
    // provider's launch fetch in the session host goes to dev.azure.com.
    n10Config: {
      vendorAuth: { 'azure-devops': { pat: 'not-a-real-token' } },
      prPollInterval: 3_600_000,
      mergePollInterval: 3_600_000,
    },
    projectConfig: {
      vendor: 'azure-devops',
      vendorProject: { org: 'acme', project: 'widgets', repo: 'widgets' },
    },
  });

  test('refuses a provider to the session host, the main process and the window', async ({
    desktop,
  }) => {
    const { app, page, homeDir } = desktop;
    const refused: string[] = [];
    const refusals = () => {
      refused.push(...takeNetworkRefusals(homeDir));
      return refused;
    };

    await expect
      .poll(refusals)
      .toContain('utility: a connection to dev.azure.com');

    // Node's own fetch in the main process.
    const main = await app.evaluate(() =>
      fetch('https://api.github.com/').then(
        () => 'reached',
        () => 'refused'
      )
    );
    expect(main).toBe('refused');

    // Chromium's, from the window and from the main process. `no-cors`
    // resolves on any answer, so only a refusal rejects.
    const window = await page.evaluate(() =>
      fetch('https://github.com/', { mode: 'no-cors' }).then(
        () => 'reached',
        () => 'refused'
      )
    );
    expect(window).toBe('refused');
    const net = await app.evaluate(({ net }) =>
      net.fetch('https://dev.azure.com/').then(
        () => 'reached',
        () => 'refused'
      )
    );
    expect(net).toBe('refused');

    expect(refusals()).toEqual(
      expect.arrayContaining([
        'browser: a connection to api.github.com',
        'browser: GET https://github.com/',
        'browser: GET https://dev.azure.com/',
      ])
    );
  });
});
