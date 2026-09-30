import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  openPalette,
  sessionMenu,
  showChanges,
  sidebarRow,
  tab,
} from './setup/app.js';
import { armContextMenuChoice, clickAppMenuItem } from './setup/menu.js';
import type { FakeGitHub } from './setup/fake-gh.js';
import { fleetView } from './setup/machines.js';

/**
 * Screenshot comparisons, kept to the surfaces where they earn their
 * keep: dialogs and full-window layout. One image catches a whole class
 * of things assertions do not — a dialog that renders off-centre or
 * behind its overlay, a pane that collapsed to zero height, a control
 * that lost its label, a theme that half-applied.
 *
 * Kept honest about their limits:
 *   • The repo name is fixed (`n10-visual`) rather than a random
 *     tempdir, or every run would differ.
 *   • Animations are disabled and the caret hidden, so a capture cannot
 *     land mid-transition.
 *   • The terminal is never in shot — it renders agent output and a
 *     blinking cursor.
 *
 * These run only inside the pinned container (`nx e2e:visual
 * desktop-e2e`), which is the whole point: fonts differ between this
 * machine, another developer's and the CI runner, and a pixel-ratio
 * tolerance is far stricter on a small dialog than on a full window.
 * The default `e2e` target skips them.
 *
 * A diff here means "look at it", not "something is broken": regenerate
 * with `node run-visual.mjs --update-snapshots` once you have.
 */

/** Zero tolerance: everything renders in one pinned container. */
const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

/** The sidebar's Fleet section shows beam's answer, not its loading
 *  skeleton: the app's own daemon starts unenrolled in the fixture
 *  HOME, and how long it takes is no part of any shot. */
test.beforeEach(async ({ desktop }) => {
  await expect(
    fleetView(desktop.page).getByRole('heading', {
      name: 'Your machines, connected anywhere',
    })
  ).toBeVisible({ timeout: 30_000 });
});

test.describe('Visual @visual', () => {
  test.use({ repo: { name: 'n10-visual' } });

  test('empty workspace', async ({ desktop }) => {
    const { page } = desktop;
    await expect(
      page.getByText('No worktrees or pull requests yet.')
    ).toBeVisible();
    await expect(page).toHaveScreenshot('workspace-empty.png', shot);
  });

  test('command palette', async ({ desktop }) => {
    const { page } = desktop;
    await openPalette(page);
    await expect(page.getByText('Open settings')).toBeVisible();
    await expect(page).toHaveScreenshot('command-palette.png', shot);
  });

  test('settings page', async ({ desktop }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Appearance' })
    ).toBeVisible();
    await expect(page).toHaveScreenshot('settings.png', shot);
  });

  test('remove worktree dialog', async ({ desktop }) => {
    const { page, app } = desktop;
    await createWorktree(page, 'visual-branch');

    await armContextMenuChoice(app, 'Remove worktree…');
    await sidebarRow(page, /visual-branch/).click({ button: 'right' });

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Remove worktree?')).toBeVisible();
    // Wait for the safety check to answer, or the dialog is caught
    // mid-flight with its warning still missing.
    await expect(
      dialog.getByRole('button', { name: /^(Remove|Force remove)$/ })
    ).toBeVisible();
    await expect(dialog).toHaveScreenshot('dialog-remove-worktree.png', shot);
  });

  test('session menu', async ({ desktop }) => {
    const { page } = desktop;
    await createWorktree(page, 'visual-branch');

    await sidebarRow(page, /visual-branch/).dblclick();
    const menu = sessionMenu(page);
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole('button', { name: 'Start new session', exact: true })
    ).toBeEnabled();
    await expect(menu).toHaveScreenshot('dialog-session-menu.png', shot);
  });

  test('keyboard shortcuts dialog', async ({ desktop }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Keyboard Shortcuts');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveScreenshot('dialog-shortcuts.png', shot);
  });
});

test.describe('Visual (diff) @visual', () => {
  test.use({
    repo: {
      name: 'n10-visual',
      worktrees: [
        {
          branch: 'diffable',
          files: { 'greeting.txt': 'hello from the worktree\nsecond line\n' },
        },
      ],
    },
  });

  test('diff viewer', async ({ desktop }) => {
    const { page } = desktop;
    await sidebarRow(page, /diffable/).click();
    await expect(page.getByText('1 file changed')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText('hello from the worktree').first()
    ).toBeVisible();
    await expect(page).toHaveScreenshot('diff-viewer.png', shot);
  });
});

test.describe('Visual (light theme) @visual', () => {
  test.use({
    repo: { name: 'n10-visual' },
    desktopPrefs: { theme: 'light', nativeFrame: false },
  });

  test('empty workspace in light theme', async ({ desktop }) => {
    const { page } = desktop;
    await expect(
      page.getByText('No worktrees or pull requests yet.')
    ).toBeVisible();
    // The palette that only the light theme uses is easy to half-apply;
    // one image covers every token at once.
    await expect(page).toHaveScreenshot('workspace-empty-light.png', shot);
  });
});

/**
 * The plan ("add to cart") checkout pane.
 *
 * This is the first screenshot of anything behind a pull request: the
 * fake `gh` (setup/fake-gh.ts) makes one exist without a token, so the
 * review workspace is finally reachable from an offline test. The shot
 * is scoped to the pane rather than the window because the comment
 * cards around it carry relative timestamps ("3d ago"), which would
 * change the image every day.
 */
const PLAN_BRANCH = 'undo-support';
const PLAN_GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 42,
      title: 'Add undo support',
      headRefName: PLAN_BRANCH,
      rollup: 'SUCCESS',
      threads: [
        {
          id: 'T1',
          path: 'undo.c',
          line: 1,
          comments: [
            {
              author: 'alice',
              body: 'The undo stack is never bounded — this grows forever.',
            },
            { author: 'bob', body: 'Agreed, a ring buffer would do.' },
          ],
        },
        {
          id: 'T2',
          path: 'undo.c',
          line: 2,
          comments: [
            { author: 'bob', body: 'Rename this to something less generic.' },
          ],
        },
      ],
    },
  ],
};

/** Queue both comments, annotate one, and open the checkout pane. */
async function buildPlan(page: Page) {
  await sidebarRow(page, /Add undo support|#42/)
    .first()
    .click();
  await showChanges(page);
  const first = page
    .locator('[data-thread]')
    .filter({ hasText: 'never bounded' });
  await expect(first).toBeVisible({ timeout: 30_000 });

  await first.hover();
  await first
    .getByRole('button', { name: 'Add to plan with a note', exact: true })
    .click();
  await page
    .getByLabel('Your note to the agent')
    .fill('Cap it at 100 entries.');
  await page.getByRole('button', { name: 'Save note' }).click();

  const second = page
    .locator('[data-thread]')
    .filter({ hasText: 'less generic' });
  await second.hover();
  await second
    .getByRole('button', { name: 'Add to plan', exact: true })
    .click();

  await page.getByRole('button', { name: /^Plan\b/ }).click();
  return page.getByRole('region', { name: 'Plan' });
}

test.describe('Visual (plan) @visual', () => {
  test.use({
    repo: {
      name: 'n10-visual',
      worktrees: [
        {
          branch: PLAN_BRANCH,
          files: { 'undo.c': 'void undo(void) {}\nint depth;\n' },
        },
      ],
    },
    fakeGitHub: PLAN_GITHUB,
  });

  test('plan checkout pane', async ({ desktop }) => {
    const pane = await buildPlan(desktop.page);
    await expect(pane).toHaveScreenshot('plan-pane.png', shot);
  });

  test('plan checkout pane with the prompt preview open', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const pane = await buildPlan(page);
    await page.getByRole('button', { name: /Prompt preview/ }).click();
    await expect(page.locator('pre')).toBeVisible();
    await expect(pane).toHaveScreenshot('plan-pane-preview.png', shot);
  });
});

test.describe('Visual (plan, light theme) @visual', () => {
  test.use({
    repo: {
      name: 'n10-visual',
      worktrees: [
        {
          branch: PLAN_BRANCH,
          files: { 'undo.c': 'void undo(void) {}\nint depth;\n' },
        },
      ],
    },
    fakeGitHub: PLAN_GITHUB,
    desktopPrefs: { theme: 'light', nativeFrame: false },
  });

  test('plan checkout pane in light theme', async ({ desktop }) => {
    const pane = await buildPlan(desktop.page);
    await expect(pane).toHaveScreenshot('plan-pane-light.png', shot);
  });
});

/** Hours before the run, so the activity's "3d ago" reads the same on
 *  every run; a fixed date's age moves a day at a time. */
const hoursAgo = (h: number) =>
  new Date(Date.now() - h * 3_600_000).toISOString();

/**
 * The pull request Overview, for a pull request someone else opened —
 * which is where it opens. One column at the window's own size, two
 * once the outer sidebar is hidden and the content pane passes 900 px,
 * and at 800×600 the review rail folded to its strip beside one column.
 */
const OVERVIEW_GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 214,
      title:
        'Handle cancelled requests without leaking the socket, the retry timer or the half-written cache entry',
      headRefName: 'cancel-requests',
      author: 'alex',
      rollup: 'SUCCESS',
      reviews: [
        { author: 'bea', state: 'APPROVED', submittedAt: hoursAgo(72) },
      ],
      reviewRequests: ['n10-tester'],
      // GitHub's own word: green, and still waiting for a review.
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'REVIEW_REQUIRED',
      checks: [
        { name: 'build', state: 'SUCCESS', required: true },
        { name: 'lint', state: 'SUCCESS', required: true },
        { name: 'docs', state: 'SKIPPED' },
      ],
      body: [
        '## Why',
        '',
        'A cancelled request kept its socket open until the server gave up.',
        '',
        '## Verification',
        '',
        '- [x] Unit tests cover cancel before connect',
        '- [ ] Soak test on staging',
        '',
        '<details>',
        '<summary>Rollout plan</summary>',
        '',
        'Ship behind the flag, then remove it after a week.',
        '',
        '</details>',
        '',
        '| Case | Before | After | Socket | Timer | Cache | Retries |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| `cancelBeforeConnect` | `leakedUntilServerTimeout` | `closedImmediatelyOnCancel` | `requestSocketCancellationRegression` | cleared | untouched | none |',
        '',
        'Trace: https://traces.example.com/sessions/cancelled-request-socket-leak/spans/0123456789abcdef',
        '',
        'Digest 9f2c1e7a4b8d3f60c5e1a2b7d9043e6f8a1c2b3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9f',
      ].join('\n'),
    },
  ],
};

const OVERVIEW_REPO = {
  name: 'n10-visual',
  worktrees: [
    {
      branch: 'cancel-requests',
      files: { 'request.ts': 'export function cancel() {}\n' },
    },
  ],
};

async function openOverview(page: Page) {
  await sidebarRow(page, /#214/).first().click();
  await expect(page.getByRole('heading', { name: 'Verification' })).toBeVisible(
    { timeout: 30_000 }
  );
  // The rail's file list settles last; a shot before it would catch
  // its loading skeleton.
  await expect(
    page.getByRole('button', { name: /request\.ts/ }).first()
  ).toBeVisible({ timeout: 30_000 });
  // The footer is in every overview shot; provider reads can finish after
  // the overview and file list, leaving a transient syncing indicator.
  await expect(page.getByText('synced just now', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('Visual (overview) @visual', () => {
  test.use({ repo: OVERVIEW_REPO, fakeGitHub: OVERVIEW_GITHUB });

  test('pull request overview', async ({ desktop }) => {
    await openOverview(desktop.page);
    await expect(desktop.page).toHaveScreenshot('pr-overview.png', shot);
  });

  test('pull request overview in two columns', async ({ desktop }) => {
    const { page } = desktop;
    await openOverview(page);
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(page).toHaveScreenshot('pr-overview-wide.png', shot);
  });

  test('pull request overview at 800×600', async ({ desktop }) => {
    const { app, page } = desktop;
    await openOverview(page);
    const titlebar = page.getByRole('banner');
    const controlsInset = await titlebar.evaluate(
      (bar) => getComputedStyle(bar).paddingRight
    );
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(0, 0);
      window.setContentSize(800, 600);
    });
    // Electron updates the native control overlay after the content resize.
    // Its button width is unchanged; wait for CSS env() geometry to catch up.
    await expect(titlebar).toHaveCSS('padding-right', controlsInset);
    await expect(page.getByText('Your review is requested')).toBeVisible();
    await expect(page).toHaveScreenshot('pr-overview-narrow.png', shot);
  });
});

test.describe('Visual (overview, dark theme) @visual', () => {
  test.use({
    repo: OVERVIEW_REPO,
    fakeGitHub: OVERVIEW_GITHUB,
    desktopPrefs: { theme: 'dark', nativeFrame: false },
  });

  test('pull request overview in two columns, dark theme', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openOverview(page);
    await page.getByRole('button', { name: 'Hide sidebar' }).click();
    await expect(page).toHaveScreenshot('pr-overview-wide-dark.png', shot);
  });
});
