import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * The review agent's guided review: a cover, then its slides, stepped
 * through with the buttons and the arrow keys, its diagrams drawn by
 * mermaid, and the last step handing the reader to the changes.
 */

const BRANCH = 'retry-reads';

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 31,
      title: 'Retry blob reads once',
      headRefName: BRANCH,
      body: 'Retries a blob read once on a network error.',
      rollup: 'SUCCESS',
    },
  ],
};

const guide = (diagram: string) => ({
  prId: 31,
  createdAt: '2026-01-01T00:00:00Z',
  title: 'Retry blob reads once',
  summary: 'One network blip broke every diff that read the file.',
  slides: [
    {
      title: 'What changes',
      lede: 'A blob read retries once, and only successes are cached.',
      body: '1. `fetchBlob` retries on a network error\n2. The cache keeps successes',
      files: [{ path: 'blob.ts', lineStart: 180, lineEnd: 181 }],
    },
    {
      title: 'Where the retry sits',
      lede: 'Below the cache, around the fetch.',
      visual: { mermaid: diagram, caption: 'The read path' },
    },
    {
      title: 'The line to check',
      before: { code: 'return fetchBlob(path)', language: 'ts' },
      after: {
        code: 'return withRetry(() => fetchBlob(path))',
        language: 'ts',
      },
    },
  ],
});

/** Long enough that the comment far down it is off screen at the top. */
const BLOB =
  'export const retries = 1;\n' +
  Array.from(
    { length: 200 },
    (_, i) => `export const line${i + 2} = ${i};`
  ).join('\n') +
  '\n';

const DIAGRAM =
  'flowchart LR\n  load[loadBlob] --> cache --> retry[withRetry] --> fetch[fetchBlob]';

test.use({
  fakeGitHub: GITHUB,
  repo: {
    worktrees: [
      {
        branch: BRANCH,
        files: { 'blob.ts': BLOB },
      },
    ],
  },
});

async function openGuide(page: Page) {
  await sidebarRow(page, /Retry blob reads once|#31/)
    .first()
    .click();
  await page
    .getByRole('button', { name: /Guided review/ })
    .click({ timeout: 30_000 });
  return page.getByRole('region', { name: 'Guided review' });
}

const slideTitle = (page: Page) => page.locator('[data-guide-slide] h2');

test.describe('Guided review', () => {
  test.use({ guides: { 31: guide(DIAGRAM) } });

  test('steps from the cover through the slides to the changes', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const pane = await openGuide(page);

    // The cover: the guide's title, its summary and the outline.
    await expect(pane.getByRole('heading', { level: 2 })).toHaveText(
      'Retry blob reads once'
    );
    await expect(pane.getByRole('list', { name: 'Outline' })).toContainText(
      'Where the retry sits'
    );

    await pane.getByRole('button', { name: 'Start' }).click();
    await expect(slideTitle(page)).toHaveText('What changes');
    await expect(pane.getByText('1 / 3')).toBeVisible();

    // The arrow keys step too; the diagram is drawn, not shown as text.
    await page.keyboard.press('ArrowRight');
    await expect(slideTitle(page)).toHaveText('Where the retry sits');
    const diagram = pane.locator('[data-diagram] svg');
    await expect(diagram).toBeVisible();
    await expect(diagram).toContainText('withRetry');

    await pane.getByRole('button', { name: 'Previous' }).click();
    await expect(slideTitle(page)).toHaveText('What changes');
    await page.keyboard.press('ArrowLeft');
    await expect(pane.locator('[data-guide-cover]')).toBeVisible();

    // The last slide shows the before and after side by side, and its
    // button opens the changes.
    await pane
      .getByRole('button', { name: 'Slide 3: The line to check' })
      .click();
    await expect(pane.locator('figure')).toHaveText([/Before/, /After/]);
    await pane.getByRole('button', { name: 'Open the changes' }).click();
    await expect(pane).toBeHidden();
    await expect(page.getByText('export const retries = 1;')).toBeVisible();
  });

  test('a slide opens the lines it names in the changes', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const pane = await openGuide(page);
    await pane.getByRole('button', { name: 'Start' }).click();
    await pane.getByRole('button', { name: /blob\.ts\s*180–181/ }).click();
    await expect(pane).toBeHidden();
    // Line 180, far down the file: not the file's top.
    await expect(
      page.getByText('export const line180 = 178;')
    ).toBeInViewport();
    await expect(
      page.getByText('export const retries = 1;')
    ).not.toBeInViewport();
  });
});

test.describe("A guide beside the agent's findings", () => {
  test.use({
    guides: { 31: guide(DIAGRAM) },
    drafts: {
      31: [
        {
          id: 'd-retries',
          file: 'blob.ts',
          lineStart: 180,
          lineEnd: 180,
          severity: 'major',
          body: 'issue: one retry hides a dead network',
          side: 'RIGHT',
          status: 'draft',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    },
  });

  test('a slide opens the comment on its lines, and the guide ends at the findings', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const pane = await openGuide(page);
    await pane.getByRole('button', { name: 'Start' }).click();
    await pane.getByRole('button', { name: /blob\.ts/ }).click();
    await expect(pane).toBeHidden();
    // At the comment, far down the file, not at the file's top.
    await expect(page.locator('[data-draft="d-retries"]')).toBeInViewport();

    // Back in the guide, on the slide it left.
    await page.getByRole('button', { name: /Guided review/ }).click();
    await expect(slideTitle(page)).toHaveText('What changes');
    await pane
      .getByRole('button', { name: 'Slide 3: The line to check' })
      .click();
    await pane.getByRole('button', { name: 'Review the finding' }).click();
    await expect(pane).toBeHidden();
    await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
  });
});

test.describe('A diagram mermaid cannot draw', () => {
  test.use({ guides: { 31: guide('flowchart LR\n  a --> (((') } });

  test('shows its source instead', async ({ desktop }) => {
    const { page } = desktop;
    const pane = await openGuide(page);
    await pane
      .getByRole('button', { name: 'Slide 2: Where the retry sits' })
      .click();
    const failed = pane.locator('[data-diagram-failed]');
    await expect(failed).toContainText('This diagram could not be drawn.');
    await expect(failed).toContainText('a --> (((');
    // Mermaid leaves no error drawing of its own in the page.
    await expect(page.locator('body > [id^="dn10-guide-diagram"]')).toHaveCount(
      0
    );
  });
});

test.describe('A diagram that asks for its own settings', () => {
  test.use({
    guides: {
      31: guide(
        '%%{init: {"securityLevel": "loose", "theme": "base", "themeVariables": ' +
          '{"primaryColor": "#ff00ff"}, "maxEdges": 1}}%%\n' +
          DIAGRAM
      ),
    },
  });

  /**
   * The diagram asks for magenta nodes; n10's own theme has none.
   * It has three edges, so it is drawn only while mermaid's own
   * `maxEdges` stays out of the diagram's reach.
   */
  test("is drawn in n10's theme all the same", async ({ desktop }) => {
    const { page } = desktop;
    const pane = await openGuide(page);
    await pane
      .getByRole('button', { name: 'Slide 2: Where the retry sits' })
      .click();
    const svg = pane.locator('[data-diagram] svg');
    await expect(svg).toContainText('withRetry');
    expect((await svg.innerHTML()).toLowerCase()).not.toContain('#ff00ff');
  });
});
