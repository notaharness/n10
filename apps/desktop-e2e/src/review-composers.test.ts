import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * New comments on code (C4, F5): select lines through the gutter on
 * one side, write a private draft with Write/Preview, and find it again
 * where it was left — after a reload, and in the other view.
 */

const BRANCH = 'cancel-cleanup';
const FILE = 'src/cancel.ts';

const BASE = [
  'export function cancel(token: Token) {',
  '  token.cancelled = true;',
  '  clearTimeout(token.timer);',
  '  token.timer = undefined;',
  '  notify(token);',
  '}',
  '',
].join('\n');

const HEAD = [
  'export function cancel(token: Token) {',
  '  token.cancelled = true;',
  '  token.stopTimer();',
  '  notify(token);',
  '  log("cancelled");',
  '}',
  '',
].join('\n');

const GITHUB: FakeGitHub = {
  username: 'bea',
  prs: [
    {
      number: 301,
      title: 'Stop timers through the token',
      headRefName: BRANCH,
      author: 'alex',
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: {
    baseFiles: { [FILE]: BASE },
    worktrees: [{ branch: BRANCH, files: { [FILE]: HEAD } }],
  },
});

async function openDiff(page: Page) {
  await sidebarRow(page, /Stop timers through the token|#301/)
    .first()
    .click();
  const gutter = gutterOf(page, 'RIGHT', 1);
  await expect(gutter).toBeVisible({ timeout: 30_000 });
}

function gutterOf(page: Page, side: 'LEFT' | 'RIGHT', line: number): Locator {
  return page.locator(`[data-file="${FILE}"][data-point="${side}:${line}"]`);
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Comment' });

test.describe('Comment composers', () => {
  test('a range on the new side becomes a private draft that survives a reload', async ({
    desktop,
  }, testInfo) => {
    const { page } = desktop;
    await openDiff(page);
    await gutterOf(page, 'RIGHT', 3).click();
    await gutterOf(page, 'RIGHT', 5).click({ modifiers: ['Shift'] });
    await expect(gutterOf(page, 'RIGHT', 4)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await page
      .getByRole('button', { name: 'Comment on new lines 3–5' })
      .click();

    await composer(page).fill('Does `stopTimer` also clear the handle?');
    await page.screenshot({ path: testInfo.outputPath('composer.png') });
    await composer(page).press('ControlOrMeta+Enter');

    const card = page.locator('[data-my-draft]');
    await expect(card).toContainText('Your draft');
    await expect(card).toContainText(`${FILE} · new lines 3–5`);
    await expect(card).toContainText('Private to you');
    await expect(card).toBeFocused();
    await expect(card).toContainText('Does stopTimer also clear the handle?');
    await page.screenshot({ path: testInfo.outputPath('card.png') });

    await page.reload();
    await openDiff(page);
    await expect(page.locator('[data-my-draft]')).toContainText(
      'Does stopTimer also clear the handle?'
    );
  });

  test('a range on the old side keeps its side in the other view', async ({
    desktop,
  }, testInfo) => {
    const { page } = desktop;
    await openDiff(page);
    await gutterOf(page, 'LEFT', 3).click();
    await gutterOf(page, 'LEFT', 4).click({ modifiers: ['Shift'] });
    // Shift-click on the other side starts again rather than span both.
    await gutterOf(page, 'RIGHT', 3).click({ modifiers: ['Shift'] });
    await expect(gutterOf(page, 'LEFT', 3)).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await gutterOf(page, 'LEFT', 3).click();
    await gutterOf(page, 'LEFT', 4).click({ modifiers: ['Shift'] });
    await page
      .getByRole('button', { name: 'Comment on old lines 3–4' })
      .click();
    await composer(page).fill('Why drop the explicit clearTimeout?');
    await page.getByRole('button', { name: 'Add to review' }).click();

    await page.getByRole('button', { name: /Split/ }).click();
    await expect(page.locator('[data-my-draft]')).toContainText(
      `${FILE} · old lines 3–4`
    );
    await gutterOf(page, 'LEFT', 1).click();
    await gutterOf(page, 'LEFT', 2).click({ modifiers: ['Shift'] });
    await page.screenshot({ path: testInfo.outputPath('split.png') });
  });

  test('the keyboard selects, extends and opens a comment', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await gutterOf(page, 'RIGHT', 1).focus();
    await page.keyboard.press('ArrowDown');
    await expect(gutterOf(page, 'RIGHT', 2)).toBeFocused();
    // Extending steps over the removed lines: the range stays new-side.
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(gutterOf(page, 'RIGHT', 4)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(composer(page)).toBeFocused();
    await expect(page.getByText(`${FILE} · new lines 2–4`)).toBeVisible();

    // Escape on an empty composer leaves nothing behind, and the
    // keyboard goes back to the line.
    await page.keyboard.press('Escape');
    await expect(composer(page)).toHaveCount(0);
    await expect(gutterOf(page, 'RIGHT', 4)).toBeFocused();
  });

  test('a comment on the whole file, written and previewed', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await page.getByRole('button', { name: `Comment on ${FILE}` }).click();
    await expect(page.getByText(`${FILE} · whole file`)).toBeVisible();
    await composer(page).fill('Worth a **test** for this.');

    await page.getByRole('radio', { name: 'Preview' }).click();
    await expect(page.locator('strong', { hasText: 'test' })).toBeVisible();
    await page.getByRole('radio', { name: 'Write' }).click();
    await expect(composer(page)).toHaveValue('Worth a **test** for this.');
    await expect(composer(page)).toBeFocused();

    await page.getByRole('button', { name: 'Add to review' }).click();
    await expect(page.locator('[data-my-draft]')).toContainText('whole file');
  });

  test('a first comment on the conversation, even with none there yet', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(
      page.getByText('No comments, reviews or activity yet.')
    ).toBeVisible();
    await page.getByRole('button', { name: 'Write a comment…' }).click();
    await composer(page).fill('Thanks, this reads well.');
    await page.getByRole('button', { name: 'Keep as draft' }).click();
    const card = page.locator('[data-my-draft="general"]');
    await expect(card).toContainText('Thanks, this reads well.');
    await expect(card).toBeFocused();

    await page.reload();
    await openDiff(page);
    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(page.locator('[data-my-draft="general"]')).toContainText(
      'Thanks, this reads well.'
    );
  });
});
