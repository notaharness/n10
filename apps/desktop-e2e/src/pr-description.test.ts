import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * The description as the provider's markdown, through the sanitized
 * path: disclosure blocks, headings under the Overview's own, links
 * that open the repository at the pull request's commit, footnotes,
 * tasks and code, an Azure DevOps mention, and markup that must not
 * run. An image that fails and then loads: `pr-description-image`.
 */

const HEAD = 'f'.repeat(40);
const GUID = 'a1b2c3d4-0000-4000-8000-000000000001';

const BODY = [
  '# Rollout',
  '',
  'Read [the retry notes](docs/retry.md) before merging, and',
  '[the loop itself](src/request.ts#L10-L20).',
  '',
  '<details>',
  '<summary>Rollout plan</summary>',
  '',
  '1. Ship behind the flag',
  '2. Remove the flag after a week',
  '',
  '</details>',
  '',
  `Thanks @<${GUID}> for the numbers.[^1]`,
  '',
  'Press <Enter> to retry; the queue is a List<string>.',
  '',
  'Mounts a <Script> tag, then continues. Use <Style> to theme it.',
  '',
  'See [the rollout notes](#rollout-notes) and [the window](#deploy-window), not [a missing part](#nowhere).',
  '',
  '- [x] Flag wired',
  '- [ ] Flag removed',
  '',
  '```ts',
  'const rollout = flag("cancel");',
  'if (rollout) start();',
  '```',
  '',
  '<script>window.__pwned = "script"</script>',
  '<iframe srcdoc="<script>parent.__pwned = \'iframe\'</script>"></iframe>',
  '<style>.overview { display: none }</style>',
  '<a href="https://example.com/first" tabindex="1" accesskey="o">Jump the queue</a>',
  '',
  '[Run this](javascript:window.__pwned="link")',
  '',
  '![Latency chart](http://127.0.0.1:9/latency.png)',
  '',
  '![Architecture](docs/arch.png)',
  '',
  '![Inline sketch](data:image/png;base64,iVBORw0KGgo=)',
  '',
  '<a name="rollout-notes"></a>Rollout notes: ship it on a Tuesday.',
  '',
  '<a name="deploy-window" href="https://example.com/window">Deploy window</a>: mornings only.',
  '',
  'The rest of the description still reads.[^café]',
  '',
  '[^1]: p95 over a day of staging traffic.',
  '[^café]: Written over coffee.',
].join('\n');

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 301,
      title: 'Roll out cancellation behind a flag',
      headRefName: 'rollout',
      author: 'alex',
      body: BODY,
    },
  ],
};

test.use({ fakeGitHub: GITHUB, repo: { worktrees: [{ branch: 'rollout' }] } });

/** Record what the app hands the system browser, instead of opening it. */
async function captureExternal(app: ElectronApplication) {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = (url: string) => {
      opened.push(url);
      return Promise.resolve();
    };
  });
  return () =>
    app.evaluate(() => (globalThis as { opened?: string[] }).opened ?? []);
}

function pwned(page: Page) {
  return page.evaluate(() => (window as { __pwned?: string }).__pwned);
}

async function openDescription(page: Page) {
  await sidebarRow(page, /#301/).first().click();
  const description = page.getByRole('region', { name: 'Description' });
  await expect(description).toContainText('The rest of the description');
  return description;
}

test.describe('Pull request description', () => {
  test('keeps a disclosure closed until the reader opens it, by keyboard', async ({
    desktop,
  }) => {
    const description = await openDescription(desktop.page);
    const summary = description.locator('summary', {
      hasText: 'Rollout plan',
    });
    await expect(summary).toBeVisible();
    await expect(description.getByText('Ship behind the flag')).toBeHidden();

    await summary.focus();
    await desktop.page.keyboard.press('Enter');
    await expect(description.getByText('Ship behind the flag')).toBeVisible();
  });

  test('puts its headings below the section heading', async ({ desktop }) => {
    const description = await openDescription(desktop.page);
    await expect(
      description.getByRole('heading', { level: 3, name: 'Rollout' })
    ).toBeVisible();
    await expect(
      description.getByRole('heading', { level: 1, name: 'Rollout' })
    ).toHaveCount(0);
  });

  test('opens a repository path at the pull request’s commit', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const opened = await captureExternal(app);
    const description = await openDescription(page);
    const link = description.getByRole('link', { name: 'the retry notes' });
    const target = `https://github.com/n10/fixture/blob/${HEAD}/docs/retry.md`;
    await expect(link).toHaveAttribute('title', target);
    await link.click();
    await expect.poll(opened).toEqual([target]);

    // The lines the author pointed at, too.
    await expect(
      description.getByRole('link', { name: 'the loop itself' })
    ).toHaveAttribute(
      'title',
      `https://github.com/n10/fixture/blob/${HEAD}/src/request.ts#L10-L20`
    );
  });

  test('runs none of the markup, and opens no script link', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const opened = await captureExternal(app);
    const description = await openDescription(page);
    // Shown as the text it is, as GitHub shows it, and never applied.
    await expect(description.locator('script, iframe, style')).toHaveCount(0);
    await expect(description).toContainText(
      '<style>.overview { display: none }</style>'
    );

    // Markup does not reorder the app's Tab sequence or claim a key.
    const jump = description.getByRole('link', { name: 'Jump the queue' });
    await expect(jump).not.toHaveAttribute('tabindex');
    await expect(jump).not.toHaveAttribute('accesskey');

    // The script address is dropped, so this is not a link at all.
    await expect(description.locator('a[href^="javascript" i]')).toHaveCount(0);
    await expect(
      description.getByRole('link', { name: 'Run this' })
    ).toHaveCount(0);
    await description.getByText('Run this').click();
    expect(await pwned(page)).toBeUndefined();
    expect(await opened()).toEqual([]);
  });

  test('keeps text that looks like a tag, an Azure DevOps mention too', async ({
    desktop,
  }) => {
    const description = await openDescription(desktop.page);
    await expect(description).toContainText(
      `Thanks @<${GUID}> for the numbers.`
    );
    await expect(description).toContainText(
      'Press <Enter> to retry; the queue is a List<string>.'
    );
    // Text that names a raw-text element keeps the words after it.
    await expect(description).toContainText(
      'Mounts a <Script> tag, then continues. Use <Style> to theme it.'
    );
  });

  test('follows a footnote within the description', async ({ desktop }) => {
    const { app, page } = desktop;
    const opened = await captureExternal(app);
    const description = await openDescription(page);
    const note = description.locator('[id="user-content-fn-1"]');
    await expect(note).toContainText('p95 over a day');
    await description.locator('a[href="#fn-1"]').click();
    await expect(note).toBeInViewport();
    // The keyboard follows the reader to the note.
    await expect(note).toBeFocused();
    expect(await opened()).toEqual([]);

    // A label outside ASCII, and a named anchor in the text.
    await description.locator('a[href="#fn-caf%C3%A9"]').click();
    await expect(
      description.locator('[id="user-content-fn-caf%C3%A9"]')
    ).toBeFocused();
    await description.getByRole('link', { name: 'the rollout notes' }).click();
    await expect(
      description.locator('[id="user-content-rollout-notes"]')
    ).toBeFocused();
    // A named anchor that is also a link is still a place to go.
    await description.getByRole('link', { name: 'the window' }).click();
    await expect(
      description.getByRole('link', { name: 'Deploy window' })
    ).toBeFocused();

    // One that names nothing says so, rather than doing nothing.
    await description.getByRole('link', { name: 'a missing part' }).click();
    await expect(
      page.getByText('Nothing in this text is called “nowhere”')
    ).toBeVisible();
  });

  test('shows tasks as checkboxes, and copies a code block', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    const description = await openDescription(page);
    const tasks = description.getByRole('checkbox');
    await expect(tasks).toHaveCount(2);
    await expect(tasks.first()).toBeChecked();
    const bullet = await description
      .locator('li', { hasText: 'Flag wired' })
      .evaluate((li) => getComputedStyle(li).listStyleType);
    expect(bullet).toBe('none');

    await description.getByRole('button', { name: 'Copy code' }).click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('const rollout = flag("cancel");\nif (rollout) start();');
  });

  test('shows an image it cannot load as that, with Retry, beside the text', async ({
    desktop,
  }) => {
    const description = await openDescription(desktop.page);
    const failed = description.getByText("Couldn't load “Latency chart”");
    await expect(failed).toBeVisible();
    await expect(
      failed
        .locator('..')
        .getByRole('button', { name: 'Retry loading “Latency chart”' })
    ).toBeVisible();
    await expect(
      description.getByText('The rest of the description still reads.')
    ).toBeVisible();
  });

  test('says which images it does not show, and offers nothing that cannot work', async ({
    desktop,
  }) => {
    const description = await openDescription(desktop.page);
    const repository = description.getByText(
      "Image “Architecture” isn't shown here"
    );
    const inline = description.getByText(
      "Image “Inline sketch” isn't shown here"
    );
    for (const note of [repository, inline]) {
      await expect(note).toBeVisible();
      await expect(note.locator('..').getByRole('button')).toHaveCount(0);
    }
  });
});
