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
  await page
    .getByRole('button', { name: 'Review changes' })
    .click({ timeout: 30_000 });
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
    await expect(
      page.getByRole('status').filter({ hasText: 'selected in' })
    ).toHaveText(`new lines 3–5 selected in ${FILE}`);
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
    // In Split an unchanged line has an old-side cell to comment on.
    await gutterOf(page, 'LEFT', 1).click();
    await gutterOf(page, 'LEFT', 2).click({ modifiers: ['Shift'] });
    await expect(gutterOf(page, 'LEFT', 2)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(
      page.getByRole('button', { name: 'Comment on old lines 1–2' })
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('split.png') });

    // Picked in Split, over unchanged lines: nothing of it in Unified.
    await page.getByRole('button', { name: /Unified/ }).click();
    await expect(
      page.getByRole('button', { name: 'Comment on old lines 1–2' })
    ).toHaveCount(0);
    await expect(gutterOf(page, 'RIGHT', 1)).toHaveAttribute('tabindex', '0');
  });

  test('in Split the keyboard starts on the new side and crosses columns', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await page.getByRole('button', { name: /Split/ }).click();
    await expect(gutterOf(page, 'RIGHT', 1)).toHaveAttribute('tabindex', '0');
    await gutterOf(page, 'RIGHT', 1).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(gutterOf(page, 'LEFT', 1)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(gutterOf(page, 'RIGHT', 1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(gutterOf(page, 'RIGHT', 3)).toBeFocused();
    // Alt+arrows belong to the diff's own navigation.
    await page.keyboard.press('Alt+ArrowDown');
    await expect(gutterOf(page, 'RIGHT', 3)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(`${FILE} · new line 3`)).toBeVisible();
  });

  test('Escape keeps the text; Discard returns to the line, and Undo brings it back', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await gutterOf(page, 'RIGHT', 3).click();
    await page.getByRole('button', { name: 'Comment on new line 3' }).click();
    await composer(page).fill('Is the timer cleared twice now?');
    await page.keyboard.press('Escape');
    const card = page.locator('[data-my-draft]');
    await expect(card).toContainText('Is the timer cleared twice now?');
    await expect(card).toBeFocused();

    await card.getByRole('button', { name: 'Discard draft' }).click();
    await expect(card).toHaveCount(0);
    await expect(gutterOf(page, 'RIGHT', 3)).toBeFocused();

    // The card is back at once, and the keyboard returns to where the
    // reader was before the toast.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(card).toContainText('Is the timer cleared twice now?');
    await expect(gutterOf(page, 'RIGHT', 3)).toBeFocused();
  });

  test('emptying an open composer keeps it open, and emptying a saved one offers Undo', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await gutterOf(page, 'RIGHT', 3).click();
    await page.getByRole('button', { name: 'Comment on new line 3' }).click();
    await composer(page).fill('first thought');
    await expect(page.getByText('Draft saved')).toBeVisible();
    // Blank text is no draft a card could show, so the stored one drops
    // out of the list once this save lands; the open box stays.
    await composer(page).press('ControlOrMeta+a');
    await page.keyboard.type(' ');
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await page.keyboard.type('second thought');
    await expect(composer(page)).toHaveValue(' second thought');
    await composer(page).press('ControlOrMeta+Enter');

    const card = page.locator('[data-my-draft]');
    await card.getByRole('button', { name: 'Edit draft' }).click();
    await composer(page).press('ControlOrMeta+a');
    await composer(page).press('Backspace');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(card).toContainText('second thought');
  });

  test('a new-side range carries across views; a refused extension is announced', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await gutterOf(page, 'RIGHT', 3).click();
    await gutterOf(page, 'RIGHT', 5).click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: /Split/ }).click();
    await expect(
      page.getByRole('button', { name: 'Comment on new lines 3–5' })
    ).toBeVisible();

    await page.getByRole('button', { name: /Unified/ }).click();
    await gutterOf(page, 'LEFT', 3).focus();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(gutterOf(page, 'LEFT', 4)).toBeFocused();
    // Past the removed run there is no old line on screen to add.
    await page.keyboard.press('Shift+ArrowDown');
    await expect(gutterOf(page, 'LEFT', 4)).toBeFocused();
    await expect(
      page.getByRole('status').filter({ hasText: 'selected in' })
    ).toHaveText(
      `old lines 3–4 selected in ${FILE}. The range can’t grow further on this side`
    );
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
    await composer(page).evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(8, 16)
    );

    await page.getByRole('radio', { name: 'Preview' }).click();
    await expect(page.locator('strong', { hasText: 'test' })).toBeVisible();
    await page.getByRole('radio', { name: 'Write' }).click();
    await expect(composer(page)).toHaveValue('Worth a **test** for this.');
    await expect(composer(page)).toBeFocused();
    // Back where the reader left it: the selection is the same.
    expect(
      await composer(page).evaluate((el: HTMLTextAreaElement) => [
        el.selectionStart,
        el.selectionEnd,
      ])
    ).toEqual([8, 16]);

    await page.getByRole('button', { name: 'Add to review' }).click();
    await expect(page.locator('[data-my-draft]')).toContainText('whole file');
  });

  test('a file marked Viewed still takes a comment on the whole file', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await page.getByRole('button', { name: 'Viewed', exact: true }).click();
    await expect(gutterOf(page, 'RIGHT', 1)).toHaveCount(0);
    await page.getByRole('button', { name: `Comment on ${FILE}` }).click();
    await expect(composer(page)).toBeFocused();
    await composer(page).fill('Generated? Then say so in the header.');
    await page.getByRole('button', { name: 'Add to review' }).click();
    await expect(page.locator('[data-my-draft]')).toBeFocused();
    await expect(page.getByText('1 yours')).toBeVisible();
  });

  test('a first comment on the conversation, even with none there yet', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openDiff(page);
    await page.getByRole('button', { name: 'Back to review' }).click();
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
    await page.getByRole('button', { name: 'Back to review' }).click();
    await expect(card).toContainText('Thanks, this reads well.');

    // Discard in the open composer returns to the prompt; Undo returns
    // to the card, and stays there once the toast has gone.
    const prompt = page.getByRole('button', { name: 'Write a comment…' });
    await card.getByRole('button', { name: 'Edit draft' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(prompt).toBeFocused();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(card).toContainText('Thanks, this reads well.');
    await expect(card).toBeFocused();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    // Sonner hands focus back as the toast unmounts: a frame later.
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    );
    await expect(card).toBeFocused();
  });
});
