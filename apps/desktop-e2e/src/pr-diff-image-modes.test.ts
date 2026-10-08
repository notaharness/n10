import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { showChanges, sidebarRow } from './setup/app.js';
import {
  BLUE,
  commitBranch,
  compareOf,
  decoded,
  IMAGES_FIXTURE,
  layer,
  ONE_SIDED_HEIGHT,
  pushAndOpen,
  RED,
  seedMain,
  TWO_SIDED_HEIGHT,
  worktreeOf,
} from './setup/image-diff.js';
import { disc, gradient } from './setup/png.js';

/**
 * A changed image's two sides are compared side by side, in turn in one
 * frame, or split in one frame by a divider the reader drags. The last
 * choice, made from any image's row, holds for every image row after
 * it, across a restart, from the desktop prefs. One side alone has
 * nothing to compare and offers no choice.
 */

test.use(IMAGES_FIXTURE);

/** Two changed images and an added one. */
async function openImages(page: Page, repoPath: string, homeDir: string) {
  seedMain(repoPath, {
    'logo.png': disc(48, [...RED]),
    'mark.png': disc(30, [...BLUE]),
  });
  const worktree = worktreeOf(repoPath);
  writeFileSync(
    join(worktree, 'logo.png'),
    gradient(96, 64, [...BLUE], [...RED])
  );
  writeFileSync(join(worktree, 'mark.png'), disc(36, [...RED]));
  writeFileSync(join(worktree, 'new.png'), disc(40, [...BLUE]));
  commitBranch(repoPath, 'images');
  await pushAndOpen(page, homeDir);
  const logo = compareOf(page, 'logo.png');
  await expect(logo).toBeVisible({ timeout: 30_000 });
  return logo;
}

const mode = (compare: Locator, name: string) =>
  compare.getByRole('radio', { name, exact: true });

const shownMode = (compare: Locator) => compare.getAttribute('data-image-mode');

function remembered(homeDir: string): unknown {
  const prefs = JSON.parse(
    readFileSync(join(homeDir, '.n10', 'desktop-prefs.json'), 'utf8')
  ) as { imageCompare?: unknown };
  return prefs.imageCompare;
}

const height = async (el: Locator) =>
  Math.round((await el.boundingBox())!.height);

test('switches how every image’s two sides are compared, and keeps the choice after a restart', async ({
  desktop,
}) => {
  const { repoPath, homeDir } = desktop;
  const logo = await openImages(desktop.page, repoPath, homeDir);
  expect(await shownMode(logo)).toBe('side-by-side');
  await expect(mode(logo, 'Side by side')).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect(logo.locator('[data-image-frame]')).toHaveCount(2);

  await mode(logo, 'Toggle').click();
  await expect(logo).toHaveAttribute('data-image-mode', 'toggle');
  await expect(logo.locator('[data-image-frame]')).toHaveCount(1);
  expect(await height(logo)).toBe(TWO_SIDED_HEIGHT);
  // Every image row follows the choice.
  const mark = compareOf(desktop.page, 'mark.png');
  await mark.scrollIntoViewIfNeeded();
  await expect(mark).toHaveAttribute('data-image-mode', 'toggle');
  // One side has nothing to compare: no choice, side by side.
  const added = compareOf(desktop.page, 'new.png');
  await added.scrollIntoViewIfNeeded();
  await expect(added).toHaveAttribute('data-image-mode', 'side-by-side');
  await expect(added.getByRole('radio')).toHaveCount(0);
  expect(await height(added)).toBe(ONE_SIDED_HEIGHT);

  // Chosen from another row, it holds for the first too.
  await mode(mark, 'Slider').click();
  await expect(mark).toHaveAttribute('data-image-mode', 'slider');
  await expect(logo).toHaveAttribute('data-image-mode', 'slider');
  expect(await height(mark)).toBe(TWO_SIDED_HEIGHT);
  await expect.poll(() => remembered(homeDir)).toBe('slider');

  await desktop.relaunch();
  const row = sidebarRow(desktop.page, /Images, pushed/);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await showChanges(desktop.page);
  const again = compareOf(desktop.page, 'logo.png');
  await expect(again).toBeVisible({ timeout: 30_000 });
  await expect(again).toHaveAttribute('data-image-mode', 'slider');
  await expect(mode(again, 'Slider')).toHaveAttribute('aria-checked', 'true');
});

/** When the shown side changes, in ms since the first sample, over `ms`. */
function flips(el: Element, ms: number): Promise<number[]> {
  return new Promise((resolve) => {
    const start = performance.now();
    const at: number[] = [];
    const observer = new MutationObserver(() =>
      at.push(Math.round(performance.now() - start))
    );
    observer.observe(el, { attributeFilter: ['data-image-toggle'] });
    setTimeout(() => {
      observer.disconnect();
      resolve(at);
    }, ms);
  });
}

test('toggle shows each side in turn about once a second, and holds still under reduced motion', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const logo = await openImages(page, repoPath, homeDir);
  await mode(logo, 'Toggle').click();
  const figure = logo.locator('[data-image-toggle]');
  await expect
    .poll(() =>
      decoded(
        layer(logo, 'after').getByRole('img', { name: 'After: logo.png' })
      )
    )
    .toBe('96×64');

  const seen = await figure.evaluate(flips, 3_500);
  expect(seen.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < seen.length; i++) {
    const gap = seen[i]! - seen[i - 1]!;
    expect(gap).toBeGreaterThan(800);
    expect(gap).toBeLessThan(1_300);
  }
  // Only the side shown is visible, and its caption names it.
  await expect(figure).toHaveAttribute('data-image-toggle', 'after');
  await expect(layer(logo, 'after')).toBeVisible();
  await expect(layer(logo, 'before')).toBeHidden();
  await expect(figure.locator('figcaption')).toHaveText(/^After · .* · 96×64$/);
  await expect(figure).toHaveAttribute('data-image-toggle', 'before');
  await expect(layer(logo, 'before')).toBeVisible();
  await expect(layer(logo, 'after')).toBeHidden();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = (await figure.getAttribute('data-image-toggle')) as
    | 'before'
    | 'after';
  expect(await figure.evaluate(flips, 2_500)).toEqual([]);
  const other = ({ before: 'after', after: 'before' } as const)[still];
  await logo.getByRole('button', { name: `Show ${other}` }).click();
  await expect(figure).toHaveAttribute('data-image-toggle', other);
  await expect(layer(logo, other)).toBeVisible();
});

/** How much of the frame, from the left, shows the before side. */
const revealed = (compare: Locator) =>
  layer(compare, 'after').evaluate((el) => {
    const inset = /inset\(0px 0px 0px ([\d.]+)%\)/.exec(
      getComputedStyle(el).clipPath
    );
    return inset ? Number(inset[1]) : null;
  });

test('slider’s divider is dragged by mouse and touch, pressed into place and moved by the keyboard', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const logo = await openImages(page, repoPath, homeDir);
  await mode(logo, 'Slider').click();
  const divider = logo.getByRole('slider', {
    name: 'Divider between before and after',
  });
  await expect(divider).toHaveAttribute('aria-valuenow', '50');
  expect(await revealed(logo)).toBe(50);
  // Both sides are there, the after side over the before.
  await expect(
    layer(logo, 'before').getByRole('img', { name: 'Before: logo.png' })
  ).toBeVisible();
  await expect(
    layer(logo, 'after').getByRole('img', { name: 'After: logo.png' })
  ).toBeVisible();

  const frame = (await logo.locator('[data-image-frame]').boundingBox())!;
  const handle = (await divider.boundingBox())!;
  const y = frame.y + frame.height / 2;
  await page.mouse.move(handle.x + handle.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.25, y, { steps: 8 });
  await page.mouse.up();
  const dragged = Number(await divider.getAttribute('aria-valuenow'));
  expect(Math.abs(dragged - 25)).toBeLessThanOrEqual(1);
  expect(await revealed(logo)).toBe(dragged);

  // A press anywhere in the frame takes the divider there.
  await page.mouse.click(frame.x + frame.width * 0.8, y);
  const pressed = Number(await divider.getAttribute('aria-valuenow'));
  expect(Math.abs(pressed - 80)).toBeLessThanOrEqual(1);

  await expect(divider).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', String(pressed + 1));
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', String(pressed - 1));
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '0');
  await expect(divider).toHaveAttribute(
    'aria-valuetext',
    '0% before, 100% after'
  );
  expect(await revealed(logo)).toBe(0);
  await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '100');
  expect(await revealed(logo)).toBe(100);

  // A finger drags it too: the frame takes no touch scrolling of its own.
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: x === undefined ? [] : [{ x, y }],
    });
  await touch('touchStart', frame.x + frame.width * 0.9);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', frame.x + frame.width * (0.9 - (0.6 * i) / 8));
  }
  await touch('touchEnd');
  const touched = Number(await divider.getAttribute('aria-valuenow'));
  expect(Math.abs(touched - 30)).toBeLessThanOrEqual(1);
  expect(await revealed(logo)).toBe(touched);
});
