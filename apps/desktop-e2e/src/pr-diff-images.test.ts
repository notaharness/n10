import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import {
  BLUE,
  commitBranch,
  compareOf,
  decoded,
  FRAME_HEIGHT,
  IMAGES_FIXTURE,
  ONE_SIDED_HEIGHT,
  pushAndOpen,
  RED,
  seedMain,
  side,
  TWO_SIDED_HEIGHT,
  worktreeOf,
} from './setup/image-diff.js';
import { disc, gradient } from './setup/png.js';

/**
 * A changed image in a pull request's diff shows both of its sides,
 * read from the commits by blob id, in place of git's "binary" notice.
 * Each side's frame is its final size before the image is read, and an
 * image is read only once its frame nears the screen.
 */

test.use(IMAGES_FIXTURE);

test('shows a changed image’s two sides, each in its own frame', async ({
  desktop,
}, testInfo) => {
  const { page, repoPath, homeDir } = desktop;
  seedMain(repoPath, { 'logo.png': disc(48, [...RED]) });
  writeFileSync(
    join(worktreeOf(repoPath), 'logo.png'),
    gradient(96, 64, [...BLUE], [...RED])
  );
  commitBranch(repoPath, 'a new logo');

  await pushAndOpen(page, homeDir);
  const compare = compareOf(page, 'logo.png');
  await expect(compare).toBeVisible({ timeout: 30_000 });

  const before = side(compare, 'before').getByRole('img', {
    name: 'Before: logo.png',
  });
  const after = side(compare, 'after').getByRole('img', {
    name: 'After: logo.png',
  });
  await expect.poll(() => decoded(before)).toBe('48×48');
  await expect.poll(() => decoded(after)).toBe('96×64');
  await expect(side(compare, 'before').locator('figcaption')).toHaveText(
    /^Before · [\d.]+ (B|KB) · 48×48$/
  );
  await expect(side(compare, 'after').locator('figcaption')).toHaveText(
    /^After · [\d.]+ (B|KB) · 96×64$/
  );
  // Git's notice is not shown for it.
  await expect(page.getByText(/Binary file.*no lines to show/)).toHaveCount(0);

  // The frames keep the size they were given before anything was read:
  // a small image does not shrink them.
  const row = await compare.boundingBox();
  expect(Math.round(row!.height)).toBe(TWO_SIDED_HEIGHT);
  for (const which of ['before', 'after'] as const) {
    const frame = side(compare, which).locator('[data-image-frame]');
    expect(Math.round((await frame.boundingBox())!.height)).toBe(FRAME_HEIGHT);
  }

  await compare.screenshot({ path: testInfo.outputPath('image-diff.png') });
});

test('shows an added image beside nothing, and a deleted one', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  seedMain(repoPath, { 'old.png': disc(32, [...RED]) });
  const worktree = worktreeOf(repoPath);
  rmSync(join(worktree, 'old.png'));
  writeFileSync(join(worktree, 'new.png'), disc(40, [...BLUE]));
  commitBranch(repoPath, 'swap images');

  await pushAndOpen(page, homeDir);

  const added = compareOf(page, 'new.png');
  await expect(added).toBeVisible({ timeout: 30_000 });
  await expect(side(added, 'before')).toContainText('Added in this change.');
  await expect(side(added, 'before').getByRole('img')).toHaveCount(0);
  await expect
    .poll(() =>
      decoded(side(added, 'after').getByRole('img', { name: 'After: new.png' }))
    )
    .toBe('40×40');

  const deleted = compareOf(page, 'old.png');
  await deleted.scrollIntoViewIfNeeded();
  await expect(side(deleted, 'after')).toContainText('Deleted in this change.');
  await expect(side(deleted, 'after').getByRole('img')).toHaveCount(0);
  await expect
    .poll(() =>
      decoded(
        side(deleted, 'before').getByRole('img', { name: 'Before: old.png' })
      )
    )
    .toBe('32×32');
});

/** Less than `useInView`'s 200px margin. */
const LEAD = 100;

/** How far below the bottom of the diff's scroll container `el` starts. */
function gapBelowScreen(el: Element): number {
  const scroller = el.closest('[data-diff-scroll]')!;
  const top =
    el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  return Math.round(top - scroller.clientHeight);
}

/** Scroll the diff until `el` starts `gap` pixels below its bottom, a
 *  step a frame, as a drag through the list would. */
async function sweepShortOf(el: Element, gap: number): Promise<void> {
  const scroller = el.closest('[data-diff-scroll]')!;
  const top =
    el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const target = scroller.scrollTop + top - scroller.clientHeight - gap;
  while (scroller.scrollTop < target) {
    scroller.scrollTop = Math.min(target, scroller.scrollTop + 40);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/** How far `el` ends above the top of the diff's scroll container. */
function gapAboveScreen(el: Element): number {
  const scroller = el.closest('[data-diff-scroll]')!;
  return Math.round(
    scroller.getBoundingClientRect().top - el.getBoundingClientRect().bottom
  );
}

test('reads an image only once its frame nears the screen', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const worktree = worktreeOf(repoPath);
  // Few enough rows that the list mounts them all, ahead of the screen;
  // tall enough that the last ones are well below it. Each its own size:
  // equal bytes are one blob, read once for all of them.
  for (let i = 1; i <= 8; i++) {
    writeFileSync(join(worktree, `img-${i}.png`), disc(16 + i, [...BLUE]));
  }
  commitBranch(repoPath, 'eight images');

  await pushAndOpen(page, homeDir);
  const first = compareOf(page, 'img-1.png');
  await expect
    .poll(() =>
      decoded(
        side(first, 'after').getByRole('img', { name: 'After: img-1.png' })
      )
    )
    .toBe('17×17');

  // Mounted, its frame already its full size, but not read.
  const last = compareOf(page, 'img-8.png');
  await expect(last).toBeAttached();
  expect(Math.round((await last.boundingBox())!.height)).toBe(ONE_SIDED_HEIGHT);
  await expect(
    side(last, 'after').getByRole('status', {
      name: 'Loading After: img-8.png',
    })
  ).toBeAttached();
  await expect(side(last, 'after').getByRole('img')).toHaveCount(0);

  // Dragged through the list to short of the screen, by less than the
  // margin a read starts at: the margin reaches past the diff's own
  // scroll container, not only the window's, which the container clips
  // it to.
  await last.evaluate(sweepShortOf, LEAD);
  await expect
    .poll(() =>
      decoded(
        side(last, 'after').getByRole('img', { name: 'After: img-8.png' })
      )
    )
    .toBe('24×24');
  expect(await last.evaluate(gapBelowScreen)).toBe(LEAD);
  await expect(last).not.toBeInViewport();

  // One the drag passed, never near the screen while it rested, is not
  // read: a read waits for the scroll to settle.
  const passed = compareOf(page, 'img-4.png');
  expect(await passed.evaluate(gapAboveScreen)).toBeGreaterThan(200);
  expect(await side(passed, 'after').getByRole('img').count()).toBe(0);
});

test('shows a renamed image, by either name, and refuses one that is not an image', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const logo = disc(48, [...RED]);
  seedMain(repoPath, { 'logo.png': logo, 'icon.png': disc(30, [...BLUE]) });
  const worktree = worktreeOf(repoPath);
  // Moved unchanged: one blob on both sides.
  mkdirSync(join(worktree, 'brand'));
  renameSync(join(worktree, 'icon.png'), join(worktree, 'brand', 'icon.png'));
  // Renamed to a name no image has, its bytes nearly the same so git
  // pairs the two: shown as images, and sized as them from the start.
  rmSync(join(worktree, 'logo.png'));
  writeFileSync(
    join(worktree, 'logo.dat'),
    Buffer.concat([logo, Buffer.from('trailing')])
  );
  // Named as an image, binary to git, but no image format's bytes.
  writeFileSync(join(worktree, 'fake.png'), Buffer.from('not an image\0junk'));
  commitBranch(repoPath, 'rename and fake');

  await pushAndOpen(page, homeDir);

  const fake = compareOf(page, 'fake.png');
  await expect(fake).toBeVisible({ timeout: 30_000 });
  await expect(side(fake, 'after')).toContainText(
    'Can’t show this image: not an image format n10 shows'
  );
  await expect(side(fake, 'after').getByRole('img')).toHaveCount(0);

  const renamed = compareOf(page, 'logo.dat');
  await renamed.scrollIntoViewIfNeeded();
  expect(Math.round((await renamed.boundingBox())!.height)).toBe(
    TWO_SIDED_HEIGHT
  );
  await expect
    .poll(() =>
      decoded(
        side(renamed, 'before').getByRole('img', { name: 'Before: logo.png' })
      )
    )
    .toBe('48×48');
  await expect
    .poll(() =>
      decoded(
        side(renamed, 'after').getByRole('img', { name: 'After: logo.dat' })
      )
    )
    .toBe('48×48');

  const moved = compareOf(page, 'brand/icon.png');
  await moved.scrollIntoViewIfNeeded();
  expect(Math.round((await moved.boundingBox())!.height)).toBe(
    TWO_SIDED_HEIGHT
  );
  await expect
    .poll(() =>
      decoded(
        side(moved, 'before').getByRole('img', { name: 'Before: icon.png' })
      )
    )
    .toBe('30×30');
  await expect
    .poll(() =>
      decoded(
        side(moved, 'after').getByRole('img', {
          name: 'After: brand/icon.png',
        })
      )
    )
    .toBe('30×30');
});
