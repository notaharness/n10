import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  launchAgentFromRail,
  showChanges,
  sidebarRow,
  visibleText,
} from './setup/app.js';
import { updateFakeGh } from './setup/fake-gh.js';
import { diffText, git } from './setup/pr-diff.js';

/**
 * A pull request too big to read at once: every file is listed from the
 * start, bodies are read a batch at a time as the reader reaches them,
 * a large file waits to be asked for, and nothing short of a complete
 * listing reads as the whole pull request.
 */

const BRANCH = 'large';

test.use({
  n10Config: { prPollInterval: 1_000 },
  fakeGitHub: {
    username: 'n10-tester',
    prs: [{ number: 31, title: 'Large', headRefName: BRANCH }],
  },
  repo: {
    worktrees: [{ branch: BRANCH, files: { 'notes.txt': 'notes\n' } }],
  },
});

const worktreeOf = (repoPath: string) =>
  join(repoPath, '.claude', 'worktrees', BRANCH);

/** Push what was committed and open the pull request once the app has
 *  the new head: the retitle arrives in the same list read. */
async function pushAndOpen(page: Page, homeDir: string) {
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Large, pushed';
  });
  const row = sidebarRow(page, /Large, pushed/);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await showChanges(page);
}

const fileButton = (page: Page, name: string | RegExp) =>
  page.locator('[data-file-tree]').getByRole('button', { name });

const noChanges = (page: Page) => page.getByText(/No changes between/);

/** The first code line wholly inside the diff's viewport, and where. */
function topLine(page: Page): Promise<{ text: string; y: number }> {
  return page.locator('[data-diff-scroll]').evaluate((scroll) => {
    const top = scroll.getBoundingClientRect().top;
    const rows = scroll.querySelectorAll('[data-row-kind="unified"]');
    const first = Array.from(rows)
      .map((r) => ({ r, y: r.getBoundingClientRect().top - top }))
      .filter(({ y }) => y >= 0)
      .sort((a, b) => a.y - b.y)[0];
    const text = first?.r.textContent ?? '';
    return {
      text: text.replace(/^[\d\s]+[-+ ]?/, '').trim(),
      y: Math.round(first?.y ?? -1),
    };
  });
}

const padded = (i: number) => String(i).padStart(3, '0');

const numbered = (word: string) =>
  Array.from({ length: 200 }, (_, i) => `${word} ${i}\n`).join('');

test.describe('many files', () => {
  test.use({
    repo: {
      worktrees: [
        {
          branch: BRANCH,
          files: Object.fromEntries(
            Array.from({ length: 250 }, (_, i) => [
              `f-${padded(i)}.txt`,
              `content ${padded(i)}\n`,
            ])
          ),
        },
      ],
    },
  });

  test('lists every file, and reads one past the first batch when reached', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /Large/).first().click();
    await showChanges(page);
    await expect(diffText(page, 'content 000')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-file-tree]').getByRole('button', { name: /^f-/ })
    ).toHaveCount(250);

    // Past the first batch: read when jumped to, and still in view once
    // its batch lands and the notices above it take their real size.
    await fileButton(page, 'f-230.txt').click();
    await expect(diffText(page, 'content 230')).toBeInViewport();
    await expect(page.locator('div[data-file="f-230.txt"]')).toBeInViewport({
      ratio: 1,
    });
  });

  test('Find reads a match beyond the first lazy PR batch', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /Large/).first().click();
    await showChanges(page);
    await expect(diffText(page, 'content 000')).toBeVisible({
      timeout: 30_000,
    });

    await page.locator('[data-diff-scroll]').click();
    await page.keyboard.press('Control+f');
    const find = page.getByRole('searchbox', { name: 'Find in diff' });
    await find.fill('content 230');
    const count = page.getByTestId('diff-find-count');
    await expect(count).toHaveText('1 of 1', { timeout: 30_000 });
    await expect(diffText(page, 'content 230')).toBeInViewport();
    await expect(
      page.locator('[data-diff-scroll] [data-diff-search-match]')
    ).toHaveText('content 230');
  });

  test('One file Find follows its first lazy match, then allows manual paging', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /Large/).first().click();
    await showChanges(page);
    await expect(diffText(page, 'content 000')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'One file' }).click();
    const pager = page.getByRole('navigation', { name: 'Files' });
    await expect(pager).toContainText('File 1 of 250');

    await page.locator('[data-diff-scroll]').click();
    await page.keyboard.press('Control+f');
    await page
      .getByRole('searchbox', { name: 'Find in diff' })
      .fill('content 230');
    await expect(page.getByTestId('diff-find-count')).toHaveText('1 of 1', {
      timeout: 30_000,
    });
    await expect(pager).toContainText('File 231 of 250');
    await expect(diffText(page, 'content 230')).toBeInViewport();

    await pager.getByRole('button', { name: 'Previous file' }).click();
    await expect(pager).toContainText('File 230 of 250');
    await expect(diffText(page, 'content 229')).toBeInViewport();
    await expect(
      page.getByRole('searchbox', { name: 'Find in diff' })
    ).toHaveValue('content 230');
  });
});

const pad4 = (i: number) => String(i).padStart(4, '0');
const pathOf = (i: number) =>
  `pkg-${String(Math.floor(i / 100)).padStart(2, '0')}/m-${pad4(i)}.txt`;

/** `count` files of 42 lines, a hundred to a directory: a batch each. */
function manyLines(count: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    files[pathOf(i)] = Array.from(
      { length: 42 },
      (_, n) => `file ${pad4(i)} line ${n}\n`
    ).join('');
  }
  return files;
}

/** How far a file's header is below the top of the diff; null while
 *  the list has it unmounted. */
function fromTop(page: Page, path: string): Promise<number | null> {
  return page.locator(`div[data-file="${path}"]`).evaluate((el) => {
    // A row the list remounts is detached for a moment.
    const list = el.closest('[data-diff-scroll]');
    if (!list) return null;
    return Math.round(
      el.getBoundingClientRect().top - list.getBoundingClientRect().top
    );
  });
}

test.describe('files of many lines', () => {
  test.use({
    repo: { worktrees: [{ branch: BRANCH, files: manyLines(1200) }] },
  });

  test('a tree click lands on its file once the rows above are measured', async ({
    desktop,
  }) => {
    test.setTimeout(180_000);
    const { page } = desktop;
    await sidebarRow(page, /Large/).first().click();
    await showChanges(page);
    await expect(diffText(page, 'file 0000 line 0')).toBeVisible({
      timeout: 30_000,
    });
    for (const i of [1190, 550, 850, 1150, 1005, 350, 950, 1195, 700]) {
      const button = fileButton(page, new RegExp(`m-${pad4(i)}\\.txt`));
      await button.scrollIntoViewIfNeeded();
      await button.click();
      // Its batch has landed, and the rows above it take their size.
      await expect(diffText(page, `file ${pad4(i)} line 0`)).toBeVisible();
      await expect
        .poll(() => fromTop(page, pathOf(i)), {
          message: `${pathOf(i)}'s header, from the top of the diff`,
        })
        .toBe(0);
    }
  });
});

test.describe('a read let go above the reader', () => {
  // Six batches, and between the fifth and sixth a file too large to
  // read until asked for: asking is one read more than are kept, and
  // lets go of the oldest, above it.
  const big = 'pkg-05/big.txt';
  test.use({
    repo: {
      worktrees: [
        {
          branch: BRANCH,
          files: {
            ...manyLines(600),
            [big]: Array.from(
              { length: 200_000 },
              (_, i) => `big line ${i}\n`
            ).join(''),
          },
        },
      ],
    },
  });

  test('leaves what the reader sees where it was', async ({ desktop }) => {
    test.setTimeout(120_000);
    const { page } = desktop;
    await sidebarRow(page, /Large/).first().click();
    await showChanges(page);
    await expect(diffText(page, 'file 0000 line 0')).toBeVisible({
      timeout: 30_000,
    });
    for (const i of [150, 250, 350, 450, 550]) {
      const button = fileButton(page, new RegExp(`m-${pad4(i)}\\.txt`));
      await button.scrollIntoViewIfNeeded();
      await button.click();
      await expect(diffText(page, `file ${pad4(i)} line 0`)).toBeVisible();
    }
    await fileButton(page, 'big.txt').click();
    await expect.poll(() => fromTop(page, big)).toBe(0);
    // Opened, it offers its changes. The files let go above give way to
    // notices of about their size; the reader stays on this one.
    await page.getByRole('button', { name: `Added ${big}` }).click();
    await page.getByRole('button', { name: 'Load changes' }).click();
    await expect.poll(() => fromTop(page, big)).toBe(0);
    // And once its lines arrive below it.
    await expect(diffText(page, 'big line 0')).toBeVisible({
      timeout: 30_000,
    });
    await expect.poll(() => fromTop(page, big)).toBe(0);
  });
});

test.describe('a draft on a file past the first batch', () => {
  test.use({
    drafts: {
      31: [
        {
          id: 'd1',
          file: 'f-230.txt',
          lineStart: 1,
          lineEnd: 1,
          severity: 'major',
          body: 'issue: this line is wrong.',
          side: 'RIGHT',
          status: 'draft',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    },
    repo: {
      worktrees: [
        {
          branch: BRANCH,
          files: Object.fromEntries(
            Array.from({ length: 250 }, (_, i) => [
              `f-${padded(i)}.txt`,
              `content ${padded(i)}\n`,
            ])
          ),
        },
      ],
    },
  });

  test('the walkthrough reads its file, never calling it outdated', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /Large/).first().click();
    await showChanges(page);
    await page
      .getByRole('button', { name: /Review ready/ })
      .first()
      .click({ timeout: 30_000 });
    const pane = page.locator('[data-terminal-pane]');
    await expect(
      pane.getByText('content 230').filter({ visible: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(pane.getByText(/aren't in the current diff/)).toHaveCount(0);
  });
});

/** Enter on the draft's place opens it in the diff. Had the keyboard
 *  been on the page, Enter would post the draft and step to the next,
 *  leaving the walkthrough showing: each test has a second draft. */
async function expectEnterOpensDiff(page: Page) {
  await page.keyboard.press('Enter');
  await expect(
    page.locator('[data-diff-scroll]').filter({ visible: true })
  ).toBeVisible();
  await expect(page.getByText('Comment posted')).toHaveCount(0);
}

test.describe('a draft on a large file', () => {
  test.use({
    drafts: {
      31: [
        {
          id: 'd1',
          file: 'big.txt',
          lineStart: 150_001,
          lineEnd: 150_001,
          severity: 'major',
          body: 'issue: this line is wrong.',
          side: 'RIGHT',
          status: 'draft',
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'd2',
          file: 'big.txt',
          lineStart: 150_020,
          lineEnd: 150_020,
          severity: 'minor',
          body: 'nitpick: and this one.',
          side: 'RIGHT',
          status: 'draft',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    },
    repo: {
      worktrees: [
        {
          branch: BRANCH,
          files: {
            'big.txt': Array.from(
              { length: 200_000 },
              (_, i) => `line ${i}\n`
            ).join(''),
          },
        },
      ],
    },
  });

  test('the walkthrough loads its file by keyboard, and posts nothing', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /Large/).first().click();
    await page
      .getByRole('button', { name: /Review ready/ })
      .first()
      .click({ timeout: 30_000 });
    const pane = page.locator('[data-terminal-pane]');
    const load = pane.getByRole('button', { name: 'Load changes' });
    await expect(load).toBeVisible({ timeout: 30_000 });
    // Enter on the notice's button reads the file: it does not post.
    await load.focus();
    await page.keyboard.press('Enter');
    await expect(
      pane.getByText('line 150000').filter({ visible: true })
    ).toBeVisible({ timeout: 30_000 });
    // The notice went with the read: the keyboard is on the draft's
    // place in the file, not the page.
    await expect(
      pane.getByRole('button', { name: /big\.txt:150001/ })
    ).toBeFocused();
    await expectEnterOpensDiff(page);
  });
});

test.describe('walkthroughs in two tabs', () => {
  const big = (word: string) =>
    Array.from({ length: 200_000 }, (_, i) => `${word} ${i}\n`).join('');
  const draft = (id: string, body: string, line = 150_001) => ({
    id,
    file: 'big.txt',
    lineStart: line,
    lineEnd: line,
    severity: line === 150_001 ? ('major' as const) : ('minor' as const),
    body,
    side: 'RIGHT' as const,
    status: 'draft' as const,
    createdAt: '2026-01-01T00:00:00Z',
  });
  test.use({
    n10Config: { prPollInterval: 1_000, aiCommand: fakeAgent({ echo: true }) },
    fakeGitHub: {
      username: 'n10-tester',
      prs: [
        { number: 31, title: 'Large', headRefName: BRANCH },
        { number: 32, title: 'Other', headRefName: 'other' },
      ],
    },
    drafts: {
      31: [
        draft('a1', 'issue: the first tab’s draft.'),
        draft('a2', 'nitpick: the first tab’s next.', 150_020),
      ],
      32: [
        draft('b1', 'issue: the second tab’s draft.'),
        draft('b2', 'nitpick: the second tab’s next.', 150_020),
      ],
    },
    repo: {
      worktrees: [
        { branch: BRANCH, files: { 'big.txt': big('line') } },
        { branch: 'other', files: { 'big.txt': big('rows') } },
      ],
    },
  });

  test('the keyboard goes to this tab’s draft, not a hidden one’s', async ({
    desktop,
  }) => {
    const { page } = desktop;
    // A running agent keeps each tab's pane mounted behind the other.
    for (const [title, body] of [
      [/Large/, 'the first tab’s draft.'],
      [/Other/, 'the second tab’s draft.'],
    ] as const) {
      await sidebarRow(page, title).first().click();
      await launchAgentFromRail(page);
      await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
        timeout: 30_000,
      });
      await page
        .getByRole('button', { name: /Review ready/ })
        .filter({ visible: true })
        .click({ timeout: 30_000 });
      await expect(visibleText(page, body)).toBeVisible({ timeout: 30_000 });
    }
    const load = page
      .getByRole('button', { name: 'Load changes' })
      .filter({ visible: true });
    await load.focus();
    await page.keyboard.press('Enter');
    await expect(visibleText(page, 'rows 150000')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page
        .getByRole('button', { name: 'big.txt:150001', exact: true })
        .filter({ visible: true })
    ).toBeFocused();
    await expectEnterOpensDiff(page);
  });
});

test('a small file after a huge one still opens', async ({ desktop }) => {
  const { page, repoPath, homeDir } = desktop;
  const worktree = worktreeOf(repoPath);
  // Past the old 64 MiB whole-patch ceiling on its own, first in order.
  writeFileSync(join(worktree, 'a-huge.txt'), Buffer.alloc(65 << 20, 97));
  writeFileSync(join(worktree, 'z-small.txt'), 'small\n');
  git(worktree, 'add', 'a-huge.txt', 'z-small.txt');
  git(worktree, 'commit', '-q', '-m', 'a huge file');

  await pushAndOpen(page, homeDir);
  await expect(diffText(page, 'small')).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText('Not loaded: this file is 65.0 MB.')
  ).toBeVisible();
  await expect(noChanges(page)).toHaveCount(0);

  // Even alone, its patch passes the ceiling: say so, not "no lines".
  await page.getByRole('button', { name: 'Load changes' }).click();
  await expect(
    page.getByText('Even its changes pass 64.0 MB. Read it in the editor.')
  ).toBeVisible({ timeout: 60_000 });
  // The Files header says what is not shown, and why.
  const notShown = page.getByRole('group', { name: 'Files not shown' });
  await expect(notShown).toContainText(/1 of \d+ not shown/);
  await expect(notShown).toContainText('1 too large');
});

test('a large file loads its changes, then all of it, on request', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  // About 2.2 MiB, on the target branch; the pull request edits one line.
  const lines = Array.from({ length: 200_000 }, (_, i) => `line ${i}`);
  writeFileSync(join(repoPath, 'big.txt'), `${lines.join('\n')}\n`);
  git(repoPath, 'add', 'big.txt');
  git(repoPath, 'commit', '-q', '-m', 'big file');
  const worktree = worktreeOf(repoPath);
  git(worktree, 'merge', '-q', '--no-edit', 'main');
  lines[150_000] = 'the one edit';
  writeFileSync(join(worktree, 'big.txt'), `${lines.join('\n')}\n`);
  git(worktree, 'commit', '-q', '-am', 'edit one line');

  await pushAndOpen(page, homeDir);
  const notLoaded = page.getByText(/Not loaded: this file is 2\.\d MB\./);
  await expect(notLoaded).toBeVisible({ timeout: 30_000 });

  // Search cannot count a file whose body is deliberately withheld.
  await page.locator('[data-diff-scroll]').click();
  await page.keyboard.press('Control+f');
  await page
    .getByRole('searchbox', { name: 'Find in diff' })
    .fill('the one edit');
  await expect(page.getByTestId('diff-find-count')).toHaveText('0 of 0+');

  // By keyboard: each button goes with its notice, and focus lands on
  // the file's header, not the page.
  const header = page.locator('[data-file="big.txt"] button').first();
  await page.getByRole('button', { name: 'Load changes' }).focus();
  await page.keyboard.press('Enter');
  await expect(diffText(page, 'the one edit')).toBeVisible();
  await expect(diffText(page, 'line 149999')).toBeVisible();
  await expect(
    page.getByText('Showing only the changes, with 3 lines of context.')
  ).toBeVisible();
  await expect(header).toBeFocused();

  await page.getByRole('button', { name: /^Load whole file/ }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByText('Showing only the changes, with 3 lines of context.')
  ).toHaveCount(0);
  await expect(diffText(page, 'the one edit')).toBeVisible();
  // The run above the edit reaches back to the file's first lines; a
  // fixed 99,999 lines of context would have hidden 99994.
  await expect(page.getByText('149994 unchanged lines hidden')).toBeVisible();
  await expect(header).toBeFocused();
});

test.describe('a file list Git could not finish', () => {
  // Low enough that the listing stops after its first few records.
  test.use({ env: { N10_DIFF_MANIFEST_MAX_BYTES: '400' } });

  test('says the list is incomplete, never that there is nothing', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const worktree = worktreeOf(repoPath);
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(worktree, `g-${padded(i)}.txt`), `g ${i}\n`);
    }
    git(worktree, 'add', '.');
    git(worktree, 'commit', '-q', '-m', 'twenty more files');

    await pushAndOpen(page, homeDir);
    await expect(
      page.getByRole('status', { name: 'File list incomplete' })
    ).toContainText('The file list is incomplete', { timeout: 30_000 });
    await expect(noChanges(page)).toHaveCount(0);
    // Git's counts never arrived: unknown, not zero, and the total is a
    // lower bound.
    const tree = page.locator('[data-file-tree]');
    await expect(tree.getByTitle(/^Not counted/).first()).toBeVisible();
    await expect(tree.getByRole('button', { name: /^Files/ })).toContainText(
      '≥'
    );
  });
});

test.describe('one file at a time', () => {
  test.use({
    repo: {
      worktrees: [
        {
          branch: BRANCH,
          // Long enough that the last file starts well below the fold.
          files: {
            'a.txt': numbered('alpha'),
            'b.txt': numbered('bravo'),
            'c.txt': numbered('charlie'),
          },
        },
      ],
    },
  });

  test('pages through the same diff, and keeps the reader’s place', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await sidebarRow(page, /Large/).first().click();
    await showChanges(page);
    await expect(diffText(page, 'alpha 0')).toBeVisible({ timeout: 30_000 });

    // From the second file, one file at a time is that file.
    await fileButton(page, 'b.txt').click();
    await expect(diffText(page, 'bravo 0')).toBeInViewport();
    await page.getByRole('button', { name: 'One file' }).click();
    const pager = page.getByRole('navigation', { name: 'Files' });
    await expect(pager).toContainText('File 2 of 3');
    await expect(diffText(page, 'bravo 0')).toBeInViewport();

    await pager.getByRole('button', { name: 'Previous file' }).click();
    await expect(pager).toContainText('File 1 of 3');
    // Its end is the end of the list: the next file is not below it.
    await page
      .locator('[data-diff-scroll]')
      .evaluate((e) => e.scrollTo({ top: e.scrollHeight }));
    await expect(diffText(page, 'alpha 199')).toBeVisible();
    await expect(diffText(page, 'bravo 0')).toHaveCount(0);

    await pager.getByRole('button', { name: 'Next file' }).click();
    await expect(pager).toContainText('File 2 of 3');
    await expect(diffText(page, 'alpha 0')).toHaveCount(0);

    // Viewed is the same flag in both layouts.
    const viewed = (name: string) =>
      page
        .locator(`[data-file="${name}"]`)
        .getByRole('button', { name: 'Viewed' });
    await viewed('b.txt').click();
    await expect(viewed('b.txt')).toHaveAttribute('aria-pressed', 'true');

    await fileButton(page, 'c.txt').click();
    await expect(pager).toContainText('File 3 of 3');
    await expect(
      pager.getByRole('button', { name: 'Next file' })
    ).toHaveAttribute('aria-disabled', 'true');

    // Back to every file at the line the reader was on, not the file's top.
    await page
      .locator('[data-diff-scroll]')
      .evaluate((e) => e.scrollTo({ top: e.scrollHeight / 2 }));
    await expect
      .poll(async () => (await topLine(page)).text)
      .toMatch(/^charlie \d+$/);
    const before = await topLine(page);
    await page.getByRole('button', { name: 'One file' }).click();
    await expect(pager).toHaveCount(0);
    await expect.poll(() => topLine(page)).toEqual(before);
    await fileButton(page, 'b.txt').click();
    await expect(viewed('b.txt')).toHaveAttribute('aria-pressed', 'true');
  });
});
