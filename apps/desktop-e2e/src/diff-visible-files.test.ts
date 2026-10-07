import { test, expect } from './fixtures/desktop.js';
import { fileTree, launchAgentFromRail, sidebarRow } from './setup/app.js';

const BRANCH = 'visible-files';
const lines = (name: string) =>
  Array.from({ length: 90 }, (_, index) => `${name} line ${index + 1}\n`).join(
    ''
  );

test.use({
  repo: {
    worktrees: [
      {
        branch: BRANCH,
        files: {
          'a.txt': lines('a'),
          'b.txt': lines('b'),
          'c.txt': lines('c'),
        },
      },
    ],
  },
});

test('the rail follows visible diff files across scroll, layout and terminal changes', async ({
  desktop,
}) => {
  const { page } = desktop;
  await sidebarRow(page, new RegExp(BRANCH)).click();
  const tree = fileTree(page).filter({ visible: true });
  const a = tree.locator('button[title="a.txt"]');
  const b = tree.locator('button[title="b.txt"]');
  const c = tree.locator('button[title="c.txt"]');
  const highlighted = tree.locator('[data-visible-in-diff="true"]');
  await expect(a).toHaveAttribute('data-visible-in-diff', 'true');
  await expect(highlighted).toHaveCount(1);

  await b.click();
  await expect(b).toHaveAttribute('data-visible-in-diff', 'true');
  await expect(highlighted).toHaveCount(1);
  await expect(a).not.toHaveAttribute('data-visible-in-diff', 'true');
  await expect(b).toHaveAttribute('aria-current', 'true');

  const scroll = page.locator('[data-diff-scroll]').filter({ visible: true });
  await scroll.evaluate((element) => {
    element.scrollTop -= 50;
  });
  await expect(a).toHaveAttribute('data-visible-in-diff', 'true');
  await expect(b).toHaveAttribute('data-visible-in-diff', 'true');
  await expect(c).not.toHaveAttribute('data-visible-in-diff', 'true');
  await expect(highlighted).toHaveCount(2);
  // Scrolling does not move the file the reader selected.
  await expect(b).toHaveAttribute('aria-current', 'true');

  await page.getByRole('button', { name: 'One file' }).click();
  await c.click();
  await expect(c).toHaveAttribute('data-visible-in-diff', 'true');
  await expect(highlighted).toHaveCount(1);
  await launchAgentFromRail(page);
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(highlighted).toHaveCount(0);
  await c.click();
  await expect(c).toHaveAttribute('data-visible-in-diff', 'true');
  await expect(highlighted).toHaveCount(1);
});
