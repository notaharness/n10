import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, tab } from './setup/app.js';
import { tmuxAvailable } from './setup/external.js';
import { tabNames } from './setup/tab-row.js';

/**
 * The editor splits into panes, VS Code style, each with its own strip:
 * by keyboard, or by dragging a tab or a group's chip onto a pane's side
 * (or its middle, to move there). Closing a pane hands its tabs to its
 * neighbour and closes none of them. The split, with its sizes, comes
 * back on the next launch.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const panes = (page: Page) => page.locator('[data-pane-id]');
const pane = (page: Page, n: number) => panes(page).nth(n);
const content = (p: Locator) => p.locator('[data-editor-panes]');

/** Press `from` and carry it, in pointer steps, to (`fx`, `fy`) of
 *  `onto`'s box, still held. */
async function carryTo(
  page: Page,
  from: Locator,
  onto: Locator,
  fx: number,
  fy: number
) {
  const [a, b] = await Promise.all([from.boundingBox(), onto.boundingBox()]);
  if (!a || !b) throw new Error('not laid out');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy, {
    steps: 12,
  });
}

/** The saved layout, once the host has written one. */
function savedLayout(homeDir: string): Record<string, unknown> | null {
  try {
    const file = JSON.parse(
      readFileSync(join(homeDir, '.n10', 'workspace.json'), 'utf8')
    ) as { workspace: { layout: Record<string, unknown> } };
    return file.workspace.layout;
  } catch {
    return null;
  }
}

test.describe('Split panes', () => {
  test('splits by keyboard and by drag, moves a group, and closes a pane without closing a tab', async ({
    desktop,
  }) => {
    const { page } = desktop;
    for (const branch of ['alpha', 'beta', 'gamma', 'delta'])
      await createWorktree(page, branch);
    await expect
      .poll(() => tabNames(page))
      .toEqual(['alpha', 'beta', 'gamma', 'delta']);
    await expect(panes(page)).toHaveCount(1);

    // Ctrl+\ moves the active tab into a new pane on the right, which
    // takes focus.
    await tab(page, /^delta/).click();
    await page.keyboard.press('Control+\\');
    await expect(panes(page)).toHaveCount(2);
    await expect(pane(page, 1).getByRole('tab')).toHaveText([/^delta/]);
    await expect(pane(page, 1)).toHaveAttribute('data-pane-focused', 'true');
    await expect(pane(page, 0).getByRole('tab')).toHaveCount(3);

    // Escape lets go of a drag over a pane's side with nothing moved.
    await carryTo(page, tab(page, /^alpha/), content(pane(page, 1)), 0.97, 0.5);
    await expect(
      pane(page, 1).locator('[data-pane-drop="right"]')
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-pane-drop]')).toHaveCount(0);
    await page.mouse.up();
    await expect(panes(page)).toHaveCount(2);
    await expect(pane(page, 0).getByRole('tab')).toHaveCount(3);

    // Dragging a tab onto the bottom of a pane shows the half it would
    // take, and dropping it there splits that pane.
    await carryTo(page, tab(page, /^gamma/), content(pane(page, 0)), 0.5, 0.97);
    await expect(
      pane(page, 0).locator('[data-pane-drop="bottom"]')
    ).toBeVisible();
    await expect(pane(page, 0)).toContainText('Split down');
    await page.mouse.up();
    await expect(panes(page)).toHaveCount(3);
    await expect(
      page.locator('[data-pane-id]', { has: tab(page, /^gamma/) })
    ).toHaveAttribute('data-pane-focused', 'true');

    // A group's chip carries its members: dropped in the middle of the
    // pane holding delta, alpha and beta move there, and the pane they
    // left goes.
    const top = page.locator('[data-pane-id]', { has: tab(page, /^alpha/) });
    const chip = top.locator('[data-group-chip^="place:"]');
    const deltaPane = page.locator('[data-pane-id]', {
      has: tab(page, /^delta/),
    });
    await carryTo(page, chip, content(deltaPane), 0.5, 0.5);
    await expect(deltaPane.locator('[data-pane-drop="centre"]')).toBeVisible();
    await expect(deltaPane).toContainText('Move here');
    await page.mouse.up();
    await expect(panes(page)).toHaveCount(2);
    await expect(deltaPane.getByRole('tab')).toHaveCount(3);

    // Closing the focused pane moves its tabs to its neighbour; nothing
    // is closed or stopped.
    await tab(page, /^gamma/).click();
    await page.keyboard.press('Control+Alt+w');
    await expect(panes(page)).toHaveCount(1);
    await expect
      .poll(async () => (await tabNames(page)).sort())
      .toEqual(['alpha', 'beta', 'delta', 'gamma']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('comes back split, at the sizes it was left at, after a restart', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    for (const branch of ['alpha', 'beta']) await createWorktree(page, branch);
    await tab(page, /^beta/).click();
    await page.keyboard.press('Control+\\');
    await expect(panes(page)).toHaveCount(2);

    // Resize from the keyboard: the separator is the library's.
    const separator = page.locator('[data-pane-separator]');
    await separator.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => (savedLayout(homeDir)?.sizes as number[] | undefined)?.[0])
      .toBeLessThan(0.45);
    const sizes = savedLayout(homeDir)!.sizes as number[];

    await desktop.relaunch();
    const next = desktop.page;
    await expect(panes(next)).toHaveCount(2, { timeout: 30_000 });
    await expect(pane(next, 0).getByRole('tab')).toHaveText([/^alpha/]);
    await expect(pane(next, 1).getByRole('tab')).toHaveText([/^beta/]);
    await expect
      .poll(async () => {
        const [a, b] = await Promise.all([
          pane(next, 0).boundingBox(),
          pane(next, 1).boundingBox(),
        ]);
        return a && b ? a.width / (a.width + b.width) : 0;
      })
      .toBeCloseTo(sizes[0]!, 1);
  });

  test('a wrapped strip keeps to a share of its pane, and scrolls to its active tab', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const names = [
      'feature-tab-strip-wrap',
      'fix-login-redirect-loop',
      'chore-bump-dependencies',
      'feature-repo-colour-bands',
      'refactor-host-restarts',
      'spike-front-truncation',
      'docs-tab-strip',
    ];
    for (const branch of names) await createWorktree(page, branch);
    // Half the width, half the height, then half the width again: the
    // top-left pane's long names wrap onto more rows than its strip has.
    await tab(page, /^docs-tab-strip/).click();
    await page.keyboard.press('Control+\\');
    await tab(page, /^spike-front-truncation/).click();
    await page.keyboard.press('Control+Shift+|');
    await tab(page, /^chore-bump-dependencies/).click();
    await page.keyboard.press('Control+\\');
    await expect(panes(page)).toHaveCount(4);

    const topLeft = page.locator('[data-pane-id]', {
      has: tab(page, /^feature-tab-strip-wrap/),
    });
    const strip = topLeft.getByRole('tablist');
    const fit = await topLeft.evaluate((el) => {
      const list = el.querySelector<HTMLElement>('[role=tablist]')!;
      const body = el.querySelector<HTMLElement>('[data-editor-panes]')!;
      return {
        pane: el.clientHeight,
        strip: list.clientHeight,
        scrolls: list.scrollHeight > list.clientHeight,
        content: body.clientHeight,
      };
    });
    expect(fit.scrolls).toBe(true);
    expect(fit.strip).toBeLessThanOrEqual(Math.min(125, 0.4 * fit.pane) + 1);
    expect(fit.content).toBeGreaterThan(fit.pane / 2);

    // Ctrl+9 opens the pane's last tab, out of view below: the strip
    // scrolls it in.
    await tab(page, /^feature-tab-strip-wrap/).click();
    await page.keyboard.press('Control+9');
    const last = topLeft.getByRole('tab', { selected: true });
    await expect(last).toHaveText(/refactor-host-restarts/);
    await expect
      .poll(async () => {
        const [a, b] = await Promise.all([
          last.boundingBox(),
          strip.boundingBox(),
        ]);
        return !!a && !!b && a.y >= b.y && a.y + a.height <= b.y + b.height + 1;
      })
      .toBe(true);
  });
});
