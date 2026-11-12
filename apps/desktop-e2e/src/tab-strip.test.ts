import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  createWorktree,
  launchAgentFromRail,
  sidebarRow,
  switchRepo,
  tab,
  tabs,
} from './setup/app.js';
import type { FakeGitHub } from './setup/fake-gh.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import {
  armContextMenuChoice,
  armContextMenuPeek,
  clickAppMenuItem,
} from './setup/menu.js';
import { LIFT, motion, namedTabs } from './setup/tab-row.js';
import { startLoneShells } from './setup/terminals.js';

/**
 * How the tab strip lays its tabs out: what it does with more than fit,
 * how a long name is cut, the repository colour along each tab, and
 * the close button over the end of the tab.
 */

/** Seven tabs whose names, at full width, take more than one row: shells
 *  each alone in a directory, so each stands on the strip. */
const MANY = [
  'feature-tab-strip-wrap',
  'fix-login-redirect-loop',
  'chore-bump-dependencies',
  'feature-repo-colour-bands',
  'docs-tab-strip',
  'refactor-host-restarts',
  'spike-front-truncation',
];

const LONG = 'feature-tab-strip-keeps-the-end-of-a-long-branch-name';

const strip = (page: Page) => page.getByRole('tablist', { name: 'Open tabs' });

/** How many rows the tabs sit on. */
async function rows(page: Page): Promise<number> {
  const tops = await tabs(page).evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().top))
  );
  return new Set(tops).size;
}

function desktopPrefs(homeDir: string): { tabOverflow?: string } {
  return JSON.parse(
    readFileSync(join(homeDir, '.n10', 'desktop-prefs.json'), 'utf8')
  ) as { tabOverflow?: string };
}

/** Where an element is laid out; it must be. */
async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('not laid out');
  return b;
}

/** Out from over the strip, so no tab is hovered. */
const moveAway = (page: Page) => page.mouse.move(700, 600);

test.describe('Tab strip overflow', () => {
  const tabNames = (page: Page) => namedTabs(page, MANY);
  /** The tabs' order as they opened. */
  let order: string[] = [];
  test.beforeEach(async ({ desktop }) => {
    startLoneShells(desktop.homeDir, MANY);
    await expect
      .poll(async () => (await tabNames(desktop.page)).sort(), {
        timeout: 30_000,
      })
      .toEqual([...MANY].sort());
    order = await tabNames(desktop.page);
  });

  test('wraps onto more rows by default, and scrolls one row once a tab menu says so', async ({
    desktop,
  }) => {
    const { app, page, homeDir } = desktop;
    await expect(strip(page)).toHaveAttribute('data-overflow', 'wrap');
    expect(await rows(page)).toBeGreaterThan(1);

    const menu = await armContextMenuPeek(app);
    await tab(page, /docs-tab-strip/).click({ button: 'right' });
    await expect.poll(menu).toEqual(
      expect.arrayContaining([
        { label: 'Wrap Tabs onto More Rows', type: 'radio', checked: true },
        { label: 'Scroll Tabs in One Row', type: 'radio', checked: false },
      ])
    );

    await armContextMenuChoice(app, 'Scroll Tabs in One Row');
    await tab(page, /docs-tab-strip/).click({ button: 'right' });
    await expect(strip(page)).toHaveAttribute('data-overflow', 'scroll');
    expect(await rows(page)).toBe(1);
    expect(desktopPrefs(homeDir).tabOverflow).toBe('scroll');
  });

  test('a tab dragged from the second row drops into the first', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const last = tab(page, new RegExp(order.at(-1)!));
    const first = tab(page, new RegExp(order[0]!));
    const [from, to] = await Promise.all([box(last), box(first)]);
    expect(from.y).toBeGreaterThan(to.y);

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 4, to.y + to.height / 2, {
      steps: 15,
    });
    await page.mouse.up();
    await expect
      .poll(() => tabNames(page))
      .toEqual([order.at(-1), ...order.slice(0, -1)]);
  });

  test('keeps All tabs at the first row’s end, and later rows run to the strip’s edge, across a resize', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    /** Each row's top and right end, the All tabs button's box and the
     *  strip's right edge. */
    const layout = async () => {
      const edges = await tabs(page).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), right: r.right };
        })
      );
      const ends = new Map<number, number>();
      for (const e of edges)
        ends.set(e.top, Math.max(ends.get(e.top) ?? 0, e.right));
      const stripBox = await box(strip(page));
      const control = await box(page.getByRole('button', { name: 'All tabs' }));
      return {
        rows: [...ends.entries()].sort(([a], [b]) => a - b),
        right: stripBox.x + stripBox.width,
        control,
      };
    };
    const check = async () => {
      const { rows: ends, right, control } = await layout();
      expect(ends.length).toBeGreaterThan(2);
      const [first, ...below] = ends;
      // On the first row, after its last tab.
      expect(Math.round(control.y)).toBe(first![0]);
      expect(first![1]).toBeLessThanOrEqual(control.x + 0.5);
      // Every full row below it (all but the last) runs on under where
      // the button would be, to the strip's edge.
      for (const [, end] of below.slice(0, -1)) {
        expect(end).toBeGreaterThan(control.x + control.width - 1);
        expect(end).toBeLessThanOrEqual(right + 0.5);
      }
    };
    // Narrow enough for three rows.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(0, 0);
      window.setContentSize(1000, 700);
    });
    await expect(check).toPass();
    // Narrower: the rows break elsewhere, and the button keeps to the
    // first one's end.
    const before = (await layout()).right;
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      const [w, h] = window.getContentSize();
      window.setContentSize(w! - 157, h!);
    });
    await expect
      .poll(async () => (await layout()).right)
      .toBeLessThan(before - 100);
    await expect(check).toPass();
  });

  test('keeps All tabs beside the wrapped tablist, in sight while its rows scroll', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    const control = page.getByRole('button', { name: 'All tabs' });
    // Not one of the tablist's: a tablist owns tabs.
    await expect(
      strip(page).getByRole('button', { name: 'All tabs' })
    ).toHaveCount(0);
    // Short enough that the rows hit the strip's height cap and scroll.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(0, 0);
      window.setContentSize(700, 260);
    });
    await expect
      .poll(() =>
        strip(page).evaluate((el) => el.scrollHeight - el.clientHeight)
      )
      .toBeGreaterThan(0);
    await strip(page).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => strip(page).evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    const [track, button] = await Promise.all([box(strip(page)), box(control)]);
    expect(Math.round(button.y)).toBe(Math.round(track.y));
    // Left of the track's scrollbar.
    const scrollbar = await strip(page).evaluate(
      (el) => (el as HTMLElement).offsetWidth - el.clientWidth
    );
    expect(button.x + button.width).toBeLessThanOrEqual(
      track.x + track.width - scrollbar + 0.5
    );
    await expect(control).toBeInViewport();
    await control.click();
    await expect(page.getByRole('dialog', { name: 'All tabs' })).toBeVisible();
  });

  test('over the room after the last tab, a dragged tab opens the end slot and drops there', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const first = tab(page, new RegExp(order[0]!));
    const last = tab(page, new RegExp(order.at(-1)!));
    const [from, to] = await Promise.all([box(first), box(last)]);
    expect(to.y).toBeGreaterThan(from.y);

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width + 40, to.y + to.height / 2, {
      steps: 15,
    });
    await expect
      .poll(() => last.evaluate((el) => el.style.transform))
      .toMatch(/^translate3d\((?!0px, 0px)/);
    await page.mouse.up();
    await expect
      .poll(() => tabNames(page))
      .toEqual([...order.slice(1), order[0]]);
  });

  test('lifted by keyboard from the end of the first row, a tab goes down into the second', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const tops = await tabs(page).evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top))
    );
    const end = tops.lastIndexOf(tops[0]!);
    expect(end).toBeLessThan(MANY.length - 1);
    const name = order[end]!;
    const t = tab(page, new RegExp(name));
    await t.focus();
    await page.keyboard.press(LIFT);
    // The keyboard sensor starts a task after the lift. Retry only if
    // the preceding key left the tab in place, so a slow render does
    // not turn one intended step into two.
    await expect
      .poll(async () => (await motion(t)).transform)
      .toBe('translate3d(0px, 0px, 0px)');
    const down = /^translate3d\(-?[\d.]+px, [1-9]/;
    await expect(async () => {
      if (down.test((await motion(t)).transform)) return;
      await page.keyboard.press('ArrowDown');
      await expect
        .poll(async () => (await motion(t)).transform, { timeout: 400 })
        .toMatch(down);
    }).toPass();
    // The announced slot must be in the next row before the drop.
    await expect
      .poll(async () => {
        const message = await page
          .getByText(/^Position \d+ of \d+\.$/)
          .textContent();
        return Number(message?.match(/\d+/)?.[0]);
      })
      .toBeGreaterThan(end + 1);
    await page.keyboard.press('Space');
    await expect
      .poll(async () => (await tabNames(page)).indexOf(name))
      .toBeGreaterThan(end);
  });
});

test.describe('Tab strip overflow, chosen before', () => {
  test.use({ desktopPrefs: { tabOverflow: 'scroll' } });

  test('starts the way the desktop prefs say', async ({ desktop }) => {
    const { app, page, homeDir } = desktop;
    await createWorktree(page, 'alpha');
    await expect(strip(page)).toHaveAttribute('data-overflow', 'scroll');

    await armContextMenuChoice(app, 'Wrap Tabs onto More Rows');
    await tab(page, /alpha/).click({ button: 'right' });
    await expect(strip(page)).toHaveAttribute('data-overflow', 'wrap');
    expect(desktopPrefs(homeDir).tabOverflow).toBe('wrap');
  });
});

/** The label as painted, cut or not. */
const shownLabel = (t: Locator) => t.locator('[data-tab-label-shown]');

/** Whether the painted label's text ends inside its box: a cut that
 *  kept too much would run on under the tab's edge. */
const fitsItsBox = (t: Locator) =>
  shownLabel(t).evaluate((el) => {
    const text = document.createRange();
    text.selectNodeContents(el);
    return (
      text.getBoundingClientRect().right <=
      el.getBoundingClientRect().right + 0.5
    );
  });

const TITLE =
  'Handle cancelled requests without leaving the half-written cache entry behind';

/** The tab whose accessible name has the whole of `name`: alone in its
 *  place, a tab's name starts with the place's. */
const namedTab = (page: Page, name: string) =>
  tab(page, new RegExp(`${name}\\b`));

test.describe('Tab labels', () => {
  test('a name too long for its tab loses its front, and a screen reader hears it whole', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, LONG);
    const t = namedTab(page, LONG);
    await expect(t).toBeVisible();

    const shown = await shownLabel(t).evaluate((el) => el.textContent);
    expect(shown).toMatch(/^….+-a-long-branch-name$/);
    expect(LONG.endsWith(shown.slice(1))).toBe(true);
    expect(shown.length).toBeLessThan(LONG.length);
    expect(await fitsItsBox(t)).toBe(true);
    // A sighted reader gets the whole of it too, on hover.
    await expect(t).toHaveAttribute('title', new RegExp(`· ${LONG}$`, 'm'));
  });

  // Alone, with no chip, a tab names its place first; the place gives
  // way to the name when room is short.
  test('a name that fits is shown whole', async ({ desktop }) => {
    const { page } = desktop;
    await createWorktree(page, 'docs');
    const t = namedTab(page, 'docs');
    await expect(shownLabel(t)).toHaveText(/ · docs$/);
  });
});

test.describe('Tab labels of pull requests', () => {
  const GITHUB: FakeGitHub = {
    prs: [{ number: 7, title: TITLE, headRefName: 'cancel-requests' }],
  };
  test.use({
    fakeGitHub: GITHUB,
    repo: { worktrees: [{ branch: 'cancel-requests' }] },
  });

  test('a title too long for its tab loses its end, and reads from its start', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /Handle cancelled requests/).click();
    const t = namedTab(page, TITLE);
    await expect(t).toBeVisible();

    const shown = await shownLabel(t).evaluate((el) => el.textContent);
    expect(shown).toMatch(/^Handle cancelled .+…$/);
    expect(TITLE.startsWith(shown.slice(0, -1))).toBe(true);
    expect(await fitsItsBox(t)).toBe(true);
    await expect(t).toHaveAttribute('title', new RegExp(TITLE));
  });
});

/** A theme token's colour, as the page resolves it. */
function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, token);
}

const bandColor = (t: Locator) =>
  t
    .locator('[data-repo-band]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('Repository colours', () => {
  test.use({ repo: { name: 'repo-alpha' } });

  let otherRepo: string;
  test.beforeEach(() => {
    otherRepo = createTestRepo({ name: 'repo-beta' });
  });
  test.afterEach(() => cleanupTestRepo(otherRepo));

  test('each repository takes its own colour, and its tabs carry it', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await createWorktree(page, 'alpha-work');
    await switchRepo(page, otherRepo);
    await createWorktree(page, 'beta-work');

    // Opened first, alpha took the palette's first colour; beta the next.
    const alpha = tab(page, /alpha-work/);
    const beta = tab(page, /beta-work/);
    await expect
      .poll(() => bandColor(alpha))
      .toBe(await tokenColor(page, '--repo-1'));
    await expect
      .poll(() => bandColor(beta))
      .toBe(await tokenColor(page, '--repo-2'));

    // Settings belongs to no repository.
    await clickAppMenuItem(app, 'Settings…');
    const settings = tab(page, /Settings/);
    await expect(settings).toBeVisible();
    await expect(settings.locator('[data-repo-band]')).toHaveCount(0);
  });
});

test.describe('Close button on a tab asking for attention', () => {
  test.use({
    n10Config: {
      aiCommand: fakeAgent({ stream: true, intervalMs: 120, streamMs: 6000 }),
    },
  });

  test('keeps its cover opaque through the blink', async ({ desktop }) => {
    const { page, homeDir } = desktop;
    await createWorktree(page, 'worker');
    await launchAgentFromRail(page);
    await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });
    // Look away, at a shell alone in its directory: the worker stays a
    // tab of its own.
    startLoneShells(homeDir, ['elsewhere']);
    await tab(page, /elsewhere/).click({ timeout: 30_000 });
    const worker = tab(page, /worker/);
    await expect(worker).toHaveClass(/tab-attention/, { timeout: 30_000 });

    await worker.hover();
    const cover = worker
      .getByRole('button', { name: 'Close tab' })
      .locator('..');
    await expect(cover).toHaveCSS('opacity', '1');
    // Both halves of the 1.4s blink, sampled, each as the alpha it
    // paints with: Chromium writes a mixed colour as oklab().
    const seen = await cover.evaluate(async (el) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      const samples = new Map<string, number>();
      for (let i = 0; i < 16; i++) {
        const colour = getComputedStyle(el).backgroundColor;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 1, 1);
        samples.set(colour, ctx.getImageData(0, 0, 1, 1).data[3]!);
        await new Promise((r) => setTimeout(r, 100));
      }
      return [...samples.values()];
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((alpha) => alpha === 255)).toBe(true);
  });
});

test.describe('Close button', () => {
  test('the label runs to the end of the tab, and the close button covers it only on hover', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await createWorktree(page, LONG);
    // Another tab of its own to make active, a shell alone in its place.
    startLoneShells(homeDir, ['docs']);
    await tab(page, /docs/).click({ timeout: 30_000 });
    // Not the active tab: that one used to keep its close button shown.
    const t = namedTab(page, LONG);
    const close = t.getByRole('button', { name: 'Close tab' });
    const cover = close.locator('..');
    await moveAway(page);

    const [tabBox, labelBox] = await Promise.all([
      box(t),
      box(t.locator('[data-tab-label]')),
    ]);
    // All the way to the tab's padding (px-3) and its right border.
    expect(tabBox.x + tabBox.width - (labelBox.x + labelBox.width)).toBeCloseTo(
      13,
      0
    );
    await expect(cover).toHaveCSS('opacity', '0');

    await t.hover();
    await expect(cover).toHaveCSS('opacity', '1');
    const closeBox = await box(close);
    expect(closeBox.x).toBeLessThan(labelBox.x + labelBox.width);
    // Opaque, in the tab's own colour, so the label end is covered.
    const [tabBg, coverBg] = await Promise.all([
      t.evaluate((el) => getComputedStyle(el).backgroundColor),
      cover.evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(coverBg).toBe(tabBg);
    expect(coverBg).not.toMatch(/rgba\(.*, 0\)|transparent/);

    await close.click();
    await expect(t).toHaveCount(0);
  });
});
