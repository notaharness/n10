import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { sidebarRow } from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';

/**
 * Mentioning someone while writing (C3): `@` and part of a name asks the
 * provider who matches, and choosing one inserts the provider's own
 * identity — the login — even when two people share a display name.
 */

const BRANCH = 'retry-budget';
const FILE = 'src/retry.ts';

const GITHUB: FakeGitHub = {
  username: 'bea',
  mentionable: [
    { login: 'samlee', name: 'Sam Lee' },
    { login: 'slee-ops', name: 'Sam Lee' },
    { login: 'alex', name: 'Alex Author' },
  ],
  prs: [
    {
      number: 311,
      title: 'Cap retries per request',
      headRefName: BRANCH,
      author: 'alex',
    },
  ],
};

test.use({
  fakeGitHub: GITHUB,
  repo: {
    baseFiles: { [FILE]: 'export const RETRIES = 5;\n' },
    worktrees: [
      { branch: BRANCH, files: { [FILE]: 'export const RETRIES = 3;\n' } },
    ],
  },
});

async function openComposer(page: Page) {
  await sidebarRow(page, /Cap retries per request|#311/)
    .first()
    .click();
  await page.getByRole('button', { name: 'Overview' }).click();
  await page.getByRole('button', { name: 'Write a comment…' }).click();
  const box = page.getByRole('textbox', { name: 'Comment' });
  await expect(box).toBeFocused();
  return box;
}

test.describe('Mentions', () => {
  test('two people with one name: the one chosen is the one encoded', async ({
    desktop,
  }, testInfo) => {
    const { page } = desktop;
    const box = await openComposer(page);
    await box.pressSequentially('Thanks @sam');

    const list = page.getByRole('listbox', { name: 'People to mention' });
    const options = list.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText('Sam Lee');
    await expect(options.nth(0)).toContainText('samlee');
    await expect(options.nth(1)).toContainText('slee-ops');
    await expect(box).toHaveAttribute(
      'aria-controls',
      (await list.getAttribute('id'))!
    );
    await page.screenshot({ path: testInfo.outputPath('mentions.png') });

    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute(
      'aria-activedescendant',
      (await options.nth(1).getAttribute('id'))!
    );
    await page.keyboard.press('Enter');
    await expect(box).toHaveValue('Thanks @slee-ops ');
    await expect(list).toHaveCount(0);

    // Typing goes on after the mention.
    await page.keyboard.type('for the dashboards.');
    await expect(box).toHaveValue('Thanks @slee-ops for the dashboards.');

    // The box stays mounted, hidden, behind the rendered preview.
    await page.getByRole('radio', { name: 'Preview' }).click();
    await expect(
      page
        .getByText('Thanks @slee-ops for the dashboards.')
        .and(page.locator(':not(textarea)'))
    ).toBeVisible();
  });

  test('a name is clicked, Escape closes only the list, and an email is no mention', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const box = await openComposer(page);
    await box.pressSequentially('cc @al');
    const list = page.getByRole('listbox', { name: 'People to mention' });
    await list.getByRole('option', { name: /Alex Author/ }).click();
    await expect(box).toHaveValue('cc @alex ');
    await expect(box).toBeFocused();

    await box.pressSequentially('and @nobody');
    await expect(page.getByText('No one matches “nobody”')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('No one matches “nobody”')).toHaveCount(0);
    // The composer is still open, with its text.
    await expect(box).toHaveValue('cc @alex and @nobody');

    // A mention typed again where that one was opens a list again.
    await box.evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(el.value.length - '@nobody'.length, el.value.length)
    );
    await page.keyboard.press('Backspace');
    await page.keyboard.type('@sa');
    await expect(list.getByRole('option')).toHaveCount(2);
    await page.keyboard.press('Escape');

    await page.keyboard.type(' or mail bea@example.com');
    await expect(list).toHaveCount(0);
    await expect(box).not.toHaveAttribute('aria-controls');
  });

  test('Tab inserts, Mod+Enter keeps the draft, and an answer for other letters is never offered', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const box = await openComposer(page);
    const list = page.getByRole('listbox', { name: 'People to mention' });
    await box.pressSequentially('@al');
    await expect(list.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(box).toHaveValue('@alex ');
    await expect(box).toBeFocused();

    // Letters nobody matches, straight away: nothing found for "al"
    // is offered, so Enter is just a new line.
    await box.pressSequentially('@z');
    await page.keyboard.press('Enter');
    await expect(box).toHaveValue('@alex @z\n');

    await box.pressSequentially('@sam');
    await expect(list.getByRole('option')).toHaveCount(2);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.locator('[data-my-draft="general"]')).toContainText(
      '@alex @z\n@sam'
    );
  });
});
