import type { Locator, Page } from '@playwright/test';

/** Open the Finish review form from the diff's toolbar. */
export async function openFinishForm(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Finish review' }).click();
  return page.getByRole('dialog', { name: 'Finish your review' });
}

/** The count of comments that go with the review, which shows them. */
export function commentsToggle(form: Locator): Locator {
  return form.getByRole('button', { name: /^(\d+ of )?\d+ comments?$/ });
}

/** Show the comments that go with the review, to choose among them. */
export async function showComments(form: Locator): Promise<void> {
  const toggle = commentsToggle(form);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
}
