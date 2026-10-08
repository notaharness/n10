import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { launchAgentFromRail, sidebarRow } from './setup/app.js';

const BRANCH = 'find-work';
const filler = Array.from({ length: 400 }, (_, i) => `filler line ${i}`).join(
  '\n'
);

test.use({
  repo: {
    worktrees: [
      {
        branch: BRANCH,
        files: {
          'a.ts':
            'const something = useSomething();\nsomething\nconst orbitalNeedle = 1;\n',
          'b.ts': `${filler}\n`,
          'c.ts':
            'const other = orbitalNeedle;\nconst SomethingElse = something;\n',
        },
      },
    ],
  },
});

const diff = (page: Page) =>
  page.locator('[data-diff-scroll]').filter({ visible: true });
const find = (page: Page) =>
  page.getByRole('searchbox', { name: 'Find in diff' });
const count = (page: Page) => page.getByTestId('diff-find-count');
const searchMarks = (page: Page) =>
  diff(page).locator('[data-diff-search-match]');
const selectionMarks = (page: Page) =>
  diff(page).locator('[data-diff-selection-match]');

async function openDiff(page: Page) {
  await sidebarRow(page, new RegExp(BRANCH)).click();
  await expect(
    diff(page).getByText('const something = useSomething();')
  ).toBeVisible({
    timeout: 30_000,
  });
}

/** The actual glyph bounds let mouse selection work even when syntax
 * highlighting divides a line into several nested spans. */
async function wordBounds(
  page: Page,
  line: string,
  word: string,
  occurrence = 0
) {
  return diff(page)
    .locator('[data-row-kind="unified"]')
    .filter({ hasText: line })
    .nth(occurrence)
    .evaluate((row, needle) => {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const at = node.textContent?.indexOf(needle) ?? -1;
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width };
      }
      throw new Error(`Could not find ${needle} in the rendered diff row`);
    }, word);
}

test('Ctrl+F finds across the whole virtualized diff and navigates between files', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openDiff(page);
  await diff(page).click();
  await page.keyboard.press('Control+f');
  await expect(find(page)).toBeFocused();
  await find(page).fill('orbitalneedle');

  // The second match is in c.ts, well below the mounted rows at the top.
  await expect(count(page)).toContainText('1 of 2');
  await expect(
    searchMarks(page).filter({ hasText: /orbitalNeedle/i })
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(count(page)).toContainText('2 of 2');
  await expect(
    diff(page).getByText('const other = orbitalNeedle;')
  ).toBeInViewport();
  await expect(
    searchMarks(page).filter({ hasText: /orbitalNeedle/i })
  ).toHaveCount(1);

  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(count(page)).toContainText('1 of 2');
  await expect(
    diff(page).getByText('const orbitalNeedle = 1;')
  ).toBeInViewport();
  await page.getByRole('button', { name: 'Close find' }).click();
  await expect(find(page)).toHaveCount(0);
  await expect(searchMarks(page)).toHaveCount(0);
});

test('double-clicking a word highlights case-insensitive substrings', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openDiff(page);
  const bounds = await wordBounds(
    page,
    'const something = useSomething();',
    'something'
  );
  await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y);
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('something');
  await expect(
    selectionMarks(page).filter({ hasText: /^Something$/ })
  ).toHaveCount(1);
});

test('dragging a word highlights its other occurrences', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openDiff(page);
  const bounds = await wordBounds(page, 'something', 'something', 1);
  await page.mouse.move(bounds.x + 2, bounds.y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 1, bounds.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe('something');
  await expect(
    selectionMarks(page).filter({ hasText: /^Something$/ })
  ).toHaveCount(1);
});

test('find and text selection retain separate highlights', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openDiff(page);
  await diff(page).click();
  await page.keyboard.press('Control+f');
  await find(page).fill('orbitalneedle');
  await expect(count(page)).toContainText('1 of 2');

  const bounds = await wordBounds(
    page,
    'const something = useSomething();',
    'something'
  );
  await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y);
  await expect(
    selectionMarks(page).filter({ hasText: /^Something$/ })
  ).toHaveCount(1);
  await expect(
    searchMarks(page).filter({ hasText: 'orbitalNeedle' })
  ).toHaveCount(1);
  await expect(find(page)).toHaveValue('orbitalneedle');
  await expect(count(page)).toContainText('1 of 2');
});

test('manual file navigation and row updates do not return to the active match', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openDiff(page);
  await diff(page).click();
  await page.keyboard.press('Control+f');
  await find(page).fill('orbitalneedle');
  await expect(count(page)).toContainText('1 of 2');

  await page
    .locator('[data-file-tree]')
    .getByRole('button', { name: 'b.ts' })
    .click();
  const header = diff(page).locator('[data-file="b.ts"] button').first();
  await expect(header).toBeInViewport();
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(header).toBeInViewport();
  await expect(count(page)).toContainText('1 of 2');

  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(count(page)).toContainText('2 of 2');
  await expect(
    diff(page).getByText('const other = orbitalNeedle;')
  ).toBeInViewport();
});

test('collapsing the active match file stays collapsed until explicit navigation', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openDiff(page);
  await diff(page).click();
  await page.keyboard.press('Control+f');
  await find(page).fill('orbitalneedle');
  await expect(count(page)).toContainText('1 of 2');
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(count(page)).toContainText('2 of 2');

  const header = diff(page).locator('[data-file="c.ts"] button').first();
  await expect(header).toBeInViewport();
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(count(page)).toContainText('2 of 2');

  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(count(page)).toContainText('1 of 2');
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(
    diff(page).getByText('const other = orbitalNeedle;')
  ).toBeInViewport();
});

test.describe('unwrapped line', () => {
  test.use({
    repo: {
      worktrees: [
        {
          branch: BRANCH,
          files: {
            'long.ts': `${'prefix '.repeat(180)}orbitalNeedle orbitalNeedle\n`,
          },
        },
      ],
    },
  });

  test('find keeps the active occurrence in view when two matches share a far-right line', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, new RegExp(BRANCH)).click();
    await expect(
      diff(page).getByText(/orbitalNeedle orbitalNeedle/)
    ).toBeVisible({
      timeout: 30_000,
    });
    await diff(page).click();
    await page.keyboard.press('Control+f');
    await find(page).fill('orbitalneedle');
    await expect(count(page)).toContainText('1 of 2');
    await expect(searchMarks(page)).toHaveCount(2);
    await expect(searchMarks(page).nth(0)).toHaveAttribute(
      'data-diff-search-active',
      'true'
    );
    await expect(searchMarks(page).nth(0)).toBeInViewport();

    await page.getByRole('button', { name: 'Next match' }).click();
    await expect(count(page)).toContainText('2 of 2');
    await expect(searchMarks(page).nth(1)).toHaveAttribute(
      'data-diff-search-active',
      'true'
    );
    await expect(searchMarks(page).nth(1)).toBeInViewport();
  });
});

test.describe('live diff refresh', () => {
  test.use({ n10Config: { aiCommand: fakeAgent({ stream: true }) } });

  test('a changed diff updates the match count while Find stays open', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    await openDiff(page);
    await launchAgentFromRail(page);
    await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });
    await page
      .locator('[data-file-tree]')
      .getByRole('button', { name: 'a.ts' })
      .click();
    await diff(page).click();
    await page.keyboard.press('Control+f');
    await find(page).fill('orbitalneedle');
    await expect(count(page)).toContainText('1 of 2');

    writeFileSync(
      join(repoPath, '.claude', 'worktrees', BRANCH, 'a.ts'),
      'const something = useSomething();\nsomething\n'
    );
    await expect(count(page)).toContainText('1 of 1', { timeout: 30_000 });
    await expect(find(page)).toHaveValue('orbitalneedle');
  });
});
