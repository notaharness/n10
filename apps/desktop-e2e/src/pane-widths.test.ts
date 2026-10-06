import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, switchRepo, tab } from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * The workspace sidebar and the review rail keep the width the user
 * dragged them to, in pixels: across a repository switch (which
 * remounts the workspace), across worktree tabs, through hiding and
 * showing, and through a window resize, where only the content pane
 * takes up the change.
 */

/** The pane on screen; a hidden spare tab has one of its own. */
function pane(page: Page, id: string) {
  return page.locator(`[data-panel][id="${id}"]:visible`);
}

function paneWidth(page: Page, id: string): Promise<number> {
  return pane(page, id).evaluate((el) =>
    Math.round(el.getBoundingClientRect().width)
  );
}

/** Drag the separator on a pane's right edge by `dx` pixels. */
async function dragEdge(page: Page, id: string, dx: number): Promise<void> {
  const box = await pane(page, id).boundingBox();
  if (!box) throw new Error(`no ${id} pane on screen`);
  const x = box.x + box.width;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y);
  await page.mouse.move(x + dx, y);
  await page.mouse.up();
}

function resizeWindow(app: ElectronApplication, dx: number): Promise<void> {
  return app.evaluate(({ BrowserWindow }, d) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [w, h] = win.getSize();
    win.setSize(w + d, h);
  }, dx);
}

test.describe('Pane widths', () => {
  test.use({ repo: { name: 'repo-alpha' } });

  test.describe('across repositories', () => {
    let otherRepo: string;

    test.beforeEach(() => {
      otherRepo = createTestRepo({ name: 'repo-beta' });
    });

    test.afterEach(() => {
      cleanupTestRepo(otherRepo);
    });

    test('the sidebar keeps its dragged width across a repo switch and a window resize', async ({
      desktop,
    }) => {
      const { app, page } = desktop;
      await expect(pane(page, 'sidebar')).toBeVisible();

      const before = await paneWidth(page, 'sidebar');
      await dragEdge(page, 'sidebar', 80);
      const dragged = before + 80;
      await expect.poll(() => paneWidth(page, 'sidebar')).toBe(dragged);

      await switchRepo(page, otherRepo);
      await expect.poll(() => paneWidth(page, 'sidebar')).toBe(dragged);

      const editor = () => paneWidth(page, 'editor');
      const editorBefore = await editor();
      await resizeWindow(app, -150);
      await expect.poll(editor).toBe(editorBefore - 150);
      expect(await paneWidth(page, 'sidebar')).toBe(dragged);
    });

    test('a keyboard resize is kept, the last key press included', async ({
      desktop,
    }) => {
      const { page } = desktop;
      await expect(pane(page, 'sidebar')).toBeVisible();

      const before = await paneWidth(page, 'sidebar');
      await page.locator('[data-separator]').first().focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(() => paneWidth(page, 'sidebar'))
        .toBeGreaterThan(before);
      const pressed = await paneWidth(page, 'sidebar');

      await switchRepo(page, otherRepo);
      await expect.poll(() => paneWidth(page, 'sidebar')).toBe(pressed);
    });
  });

  test('a double-click on the separator resets the width, and it stays reset', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await expect(pane(page, 'sidebar')).toBeVisible();
    const builtIn = await paneWidth(page, 'sidebar');
    await dragEdge(page, 'sidebar', 70);
    await expect.poll(() => paneWidth(page, 'sidebar')).toBe(builtIn + 70);

    await page.locator('[data-separator]').first().dblclick();
    await expect.poll(() => paneWidth(page, 'sidebar')).toBe(builtIn);
    // Forgotten, not stored as 280: the built-in width may change.
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem('n10.sidebar.width'))
      )
      .toBeNull();

    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await page.getByRole('button', { name: 'Show sidebar' }).click();
    await expect.poll(() => paneWidth(page, 'sidebar')).toBe(builtIn);
  });

  test('the sidebar comes back at its width after hiding through a window resize', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await expect(pane(page, 'sidebar')).toBeVisible();
    const before = await paneWidth(page, 'sidebar');
    await dragEdge(page, 'sidebar', 60);
    const dragged = before + 60;
    await expect.poll(() => paneWidth(page, 'sidebar')).toBe(dragged);

    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(pane(page, 'sidebar')).toBeHidden();
    await resizeWindow(app, 300);
    await page.getByRole('button', { name: 'Show sidebar' }).click();
    await expect.poll(() => paneWidth(page, 'sidebar')).toBe(dragged);
  });

  test('a sidebar clamped by a narrow window grows back with it', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await expect(pane(page, 'sidebar')).toBeVisible();
    const before = await paneWidth(page, 'sidebar');
    await dragEdge(page, 'sidebar', 180);
    const dragged = before + 180;
    await expect.poll(() => paneWidth(page, 'sidebar')).toBe(dragged);

    // At the 900px minimum window, 45% of the workspace is under it.
    const shrink = (await page.evaluate(() => window.innerWidth)) - 900;
    await resizeWindow(app, -shrink);
    await expect.poll(() => paneWidth(page, 'sidebar')).toBeLessThan(dragged);

    await resizeWindow(app, shrink);
    await expect.poll(() => paneWidth(page, 'sidebar')).toBe(dragged);
  });

  test('worktree tabs open in a narrow window without the rail throwing', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      // 950 - 280px sidebar leaves the review workspace well under its
      // 720px narrow breakpoint, so the rail mounts shown, then hides.
      win.setContentSize(950, 600);
    });
    // The fixture fails the test on any renderer throw.
    for (const branch of ['first-work', 'second-work', 'third-work']) {
      await createWorktree(page, branch);
    }
    await expect(tab(page, /third-work/)).toBeVisible();
    // The workspace was narrow enough to put the rail away once shown.
    await expect(
      page.getByRole('button', { name: 'Show review sidebar' })
    ).toBeVisible();
  });

  test('the review rail keeps its dragged width across worktree tabs', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'first-work');
    await expect(pane(page, 'review-rail')).toBeVisible();
    await createWorktree(page, 'second-work');
    await expect(tab(page, /second-work/)).toBeVisible();

    // first-work stays mounted, hidden, as the spare pane.
    const before = await paneWidth(page, 'review-rail');
    await dragEdge(page, 'review-rail', 90);
    const dragged = before + 90;
    await expect.poll(() => paneWidth(page, 'review-rail')).toBe(dragged);

    await tab(page, /first-work/).click();
    await expect.poll(() => paneWidth(page, 'review-rail')).toBe(dragged);

    await createWorktree(page, 'third-work');
    await expect.poll(() => paneWidth(page, 'review-rail')).toBe(dragged);
  });
});
