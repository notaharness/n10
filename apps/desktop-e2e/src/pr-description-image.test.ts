import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test as base, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';

/**
 * A description image the host refuses (spec O2's image 403): the
 * failure is the image's own, beside text that still reads, and Retry
 * fetches it again once the host serves it.
 */

/** One transparent pixel. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** An image host that refuses until told to serve. */
interface ImageHost {
  url: string;
  serve(): void;
}

const test = base.extend<{ imageHost: ImageHost }>({
  // Per test, so a retry starts from a refusal again.
  imageHost:
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture dependency parameter.
    async ({}, provide) => {
      let serving = false;
      const server = createServer((_req, res) => {
        if (serving) {
          res.writeHead(200, { 'content-type': 'image/png' }).end(PIXEL);
        } else res.writeHead(403).end();
      });
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      const { port } = server.address() as AddressInfo;
      await provide({
        url: `http://127.0.0.1:${port}`,
        serve: () => (serving = true),
      });
      server.close();
    },
  fakeGitHub: async ({ imageHost }, provide) => {
    await provide({
      username: 'n10-tester',
      prs: [
        {
          number: 301,
          title: 'Roll out cancellation behind a flag',
          headRefName: 'rollout',
          author: 'alex',
          body: `![Latency chart](${imageHost.url}/latency.png)\n\nThe text still reads.`,
        },
      ],
    });
  },
});

test.use({ repo: { worktrees: [{ branch: 'rollout' }] } });

test.describe('Pull request description image', () => {
  test('retries a refused image until it loads, with the text beside it', async ({
    desktop,
    imageHost,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /#301/).first().click();
    const description = page.getByRole('region', { name: 'Description' });
    await expect(description.getByText('The text still reads.')).toBeVisible();
    // The failure says why, in the host's words.
    await expect(
      description.getByText("Couldn't load “Latency chart”: HTTP 403")
    ).toBeVisible();
    const retry = description.getByRole('button', {
      name: 'Retry loading “Latency chart”',
    });
    const status = description.getByRole('status');

    // Refused again: the keyboard stays on Retry, and hears so.
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(status).toHaveText("Still couldn't load “Latency chart”");
    await expect(retry).toBeFocused();

    // Served: the image takes the keyboard from the Retry it replaced.
    imageHost.serve();
    await page.keyboard.press('Enter');
    // Named by its alt text; the title says a click enlarges it.
    const image = description.getByRole('button', {
      name: 'Latency chart',
      exact: true,
    });
    await expect(image).toBeFocused();
    await expect(status).toHaveText('Loaded “Latency chart”');
    await expect(description.getByText("Couldn't load")).toHaveCount(0);
  });
});
