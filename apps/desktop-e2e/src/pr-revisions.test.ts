import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { showChanges, sidebarRow, tab } from './setup/app.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueExternalBranch,
} from './setup/external.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';
import { diffText, git } from './setup/pr-diff.js';
import { recordedVisits, seedLastVisit } from './setup/review-history.js';

/**
 * Which of a pull request's changes the diff shows (spec D4): all of
 * them, those since the reader's last visit or last review, or between
 * two revisions they choose — each at exact commits, and each saying
 * why when it has nothing to compare with.
 *
 * The branch starts at H1 (a.txt). Each test pushes H2 (b.txt) before
 * opening the pull request, so "since" has something to show.
 */

const BRANCH = 'revs';
const PR = 21;

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [{ number: PR, title: 'Revisions', headRefName: BRANCH }],
};

test.use({
  n10Config: { prPollInterval: 1_000 },
  fakeGitHub: GITHUB,
  repo: { worktrees: [{ branch: BRANCH, files: { 'a.txt': 'one\n' } }] },
});

const worktreeOf = (repoPath: string) =>
  join(repoPath, '.claude', 'worktrees', BRANCH);

/** Commit a new file on the branch: a push the provider reports. */
function push(repoPath: string, path: string, text: string): string {
  const worktree = worktreeOf(repoPath);
  writeFileSync(join(worktree, path), text);
  git(worktree, 'add', path);
  git(worktree, 'commit', '-q', '-m', `add ${path}`);
  return git(worktree, 'rev-parse', 'HEAD');
}

/** Open the pull request once the list has read `title`, and go from
 *  its Overview to its changes. */
async function openAs(page: Page, title: RegExp) {
  const row = sidebarRow(page, title);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
  await showChanges(page);
}

const short = (oid: string) => oid.slice(0, 7);

function selector(page: Page) {
  return page.getByTestId('revision-selector');
}

async function choose(page: Page, option: RegExp) {
  await selector(page).click();
  await page.getByRole('option', { name: option }).click();
}

const bounds = (page: Page) => page.getByTestId('diff-comparison');

test('since your last review shows only what came after it', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const h1 = git(repoPath, 'rev-parse', BRANCH);
  const h2 = push(repoPath, 'b.txt', 'two\n');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, pushed';
    s.prs[0]!.history = { reviews: [{ commit: h1 }] };
  });
  await openAs(page, /Revisions, pushed/);
  await expect(diffText(page, 'two')).toBeVisible({ timeout: 30_000 });
  await expect(diffText(page, 'one')).toBeVisible();

  await choose(page, /Since your last review/);
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
  await expect(diffText(page, 'two')).toBeVisible();
  await expect(diffText(page, 'one')).toHaveCount(0);
  await expect(page.getByTestId('comparison-bar')).toContainText(
    '1 of 2 files'
  );

  // All changes is still the whole pull request.
  await choose(page, /All changes/);
  await expect(diffText(page, 'one')).toBeVisible();
  await expect(diffText(page, 'two')).toBeVisible();
});

test('a line takes a new comment only on a side the pull request’s comments are numbered by', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const h1 = git(repoPath, 'rev-parse', BRANCH);
  const worktree = worktreeOf(repoPath);
  writeFileSync(join(worktree, 'README.md'), 'rewritten\n');
  git(worktree, 'commit', '-q', '-am', 'rewrite the README');
  const h2 = git(worktree, 'rev-parse', 'HEAD');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, rewritten';
    s.prs[0]!.history = { reviews: [{ commit: h1 }] };
  });
  await openAs(page, /Revisions, rewritten/);
  await expect(diffText(page, 'rewritten')).toBeVisible({ timeout: 30_000 });
  const gutter = (side: 'LEFT' | 'RIGHT') =>
    page.locator(`[data-file="README.md"][data-point="${side}:1"]`);
  // The whole pull request: its old side is the merge base.
  await expect(gutter('LEFT')).toHaveCount(1);
  await expect(gutter('RIGHT')).toHaveCount(1);

  // Since the last review, the old side is H1: a comment filed on the
  // pull request would land on the merge base's line 1, not this one.
  await choose(page, /Since your last review/);
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
  await expect(gutter('RIGHT')).toHaveCount(1);
  await expect(gutter('LEFT')).toHaveCount(0);
});

test('a range that takes in the target’s changes says so, and is not counted out of the pull request’s files', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const h1 = git(repoPath, 'rev-parse', BRANCH);
  writeFileSync(join(repoPath, 'README.md'), 'moved on\n');
  git(repoPath, 'commit', '-q', '-am', 'target moves');
  git(worktreeOf(repoPath), 'merge', '-q', '--no-edit', 'main');
  const h2 = push(repoPath, 'b.txt', 'two\n');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, merged';
    s.prs[0]!.history = { reviews: [{ commit: h1 }] };
  });
  await openAs(page, /Revisions, merged/);
  await expect(diffText(page, 'two')).toBeVisible({ timeout: 30_000 });

  await choose(page, /Since your last review/);
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
  await expect(diffText(page, 'moved on')).toBeVisible();
  const bar = page.getByTestId('comparison-bar');
  await expect(bar).toContainText('Includes changes from main');
  // README.md is not one of the pull request's files.
  await expect(bar).toContainText('2 files');
  await expect(bar).not.toContainText(' of ');
});

test('a first visit has nothing to compare with, and says so', async ({
  desktop,
}) => {
  const { page } = desktop;
  await openAs(page, /Revisions/);
  await expect(diffText(page, 'one')).toBeVisible({ timeout: 30_000 });

  await selector(page).click();
  await expect(
    page.getByRole('option', { name: /Since your last visit/ })
  ).toContainText('This is your first visit');
  await page.getByRole('option', { name: /Since your last visit/ }).click();
  await expect(
    page.getByText('This is your first visit.', { exact: false })
  ).toBeVisible();
  // Never every change under its name, nor its commits.
  await expect(diffText(page, 'one')).toHaveCount(0);
  await expect(bounds(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Show all changes' }).click();
  await expect(diffText(page, 'one')).toBeVisible();
  await expect(selector(page)).toHaveText(/All changes/);
  // The button went with the notice: the keyboard is on the selector.
  await expect(selector(page)).toBeFocused();
});

test('since your last visit starts from the visit before this one, which is then recorded', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const h1 = git(repoPath, 'rev-parse', BRANCH);
  seedLastVisit(homeDir, repoPath, { number: PR, head: h1 });
  const h2 = push(repoPath, 'b.txt', 'two\n');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, pushed';
  });
  await openAs(page, /Revisions, pushed/);
  await expect(diffText(page, 'two')).toBeVisible({ timeout: 30_000 });

  await choose(page, /Since your last visit/);
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
  await expect(diffText(page, 'one')).toHaveCount(0);

  // Once its diff is on screen, this visit is recorded at H2: the next
  // one starts from there.
  await expect
    .poll(() => recordedVisits(homeDir, PR), { timeout: 30_000 })
    .toEqual([h1, h2]);

  // A reload — the recovery after a renderer crash — is the same visit:
  // it still starts from H1, and records no second one.
  await page.reload();
  await openAs(page, /Revisions, pushed/);
  await expect(diffText(page, 'two')).toBeVisible({ timeout: 30_000 });
  await choose(page, /Since your last visit/);
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
  expect(recordedVisits(homeDir, PR)).toEqual([h1, h2]);
});

test('a revision that is gone is named, never replaced', async ({
  desktop,
}) => {
  const { page, homeDir, repoPath } = desktop;
  const gone = 'e'.repeat(40);
  push(repoPath, 'b.txt', 'two\n');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, pushed';
    s.prs[0]!.history = { reviews: [{ commit: gone }] };
  });
  await openAs(page, /Revisions, pushed/);
  await expect(diffText(page, 'two')).toBeVisible({ timeout: 30_000 });

  await choose(page, /Since your last review/);
  await expect(page.getByText('Couldn’t compare these revisions')).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(/Revision eeeeeee is not in this clone/)
  ).toBeVisible();
  await expect(diffText(page, 'two')).toHaveCount(0);

  // A new head still loads: the range says again why it can't be read.
  push(repoPath, 'c.txt', 'three\n');
  const banner = page.getByRole('status', { name: 'New commits' });
  await banner.getByRole('button', { name: /Load new commits/ }).click({
    timeout: 30_000,
  });
  await expect(banner).toHaveCount(0, { timeout: 30_000 });
  await expect(
    page.getByText('Couldn’t compare these revisions')
  ).toBeVisible();

  await page.getByRole('button', { name: 'Show all changes' }).click();
  await expect(diffText(page, 'three')).toBeVisible();
});

test('two revisions chosen by hand', async ({ desktop }) => {
  const { page, repoPath, homeDir } = desktop;
  const h1 = git(repoPath, 'rev-parse', BRANCH);
  const h2 = push(repoPath, 'b.txt', 'two\n');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, pushed';
    s.prs[0]!.history = { events: [{ commit: h1 }, { commit: h2 }] };
  });
  await openAs(page, /Revisions, pushed/);
  await expect(diffText(page, 'two')).toBeVisible({ timeout: 30_000 });

  await choose(page, /Choose revisions/);
  const dialog = page.getByRole('dialog', { name: 'Compare two revisions' });
  await expect(dialog).toBeVisible();
  // The newest two by default: the head on screen, and the one before.
  await expect(dialog.getByLabel('From')).toContainText(short(h1));
  await expect(dialog.getByLabel('To')).toContainText(short(h2));
  await dialog.getByRole('button', { name: 'Compare' }).click();

  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
  await expect(diffText(page, 'one')).toHaveCount(0);
  await expect(selector(page)).toHaveText(/Chosen revisions/);
});

test('a new head keeps the range on screen until it is loaded', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const h1 = git(repoPath, 'rev-parse', BRANCH);
  const h2 = push(repoPath, 'b.txt', 'two\n');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, pushed';
    s.prs[0]!.history = { reviews: [{ commit: h1 }] };
  });
  await openAs(page, /Revisions, pushed/);
  await choose(page, /Since your last review/);
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`, {
    timeout: 30_000,
  });

  const h3 = push(repoPath, 'c.txt', 'three\n');
  const banner = page.getByRole('status', { name: 'New commits' });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(diffText(page, 'three')).toHaveCount(0);
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);

  await banner.getByRole('button', { name: /Load new commits/ }).click();
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h3)}`, {
    timeout: 30_000,
  });
  await expect(diffText(page, 'three')).toBeVisible();
  await expect(selector(page)).toHaveText(/Since your last review/);
});

test.describe('beside other tabs', () => {
  test.use({
    repo: {
      worktrees: [
        { branch: BRANCH, files: { 'a.txt': 'one\n' } },
        { branch: 'elsewhere', files: { 'e.txt': 'elsewhere\n' } },
        { branch: 'further', files: { 'f.txt': 'further\n' } },
      ],
    },
  });

  test('the chosen revisions outlive their pane and their tab, and the keyboard is never dropped', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    const h1 = git(repoPath, 'rev-parse', BRANCH);
    const h2 = push(repoPath, 'b.txt', 'two\n');
    updateFakeGh(homeDir, (s) => {
      s.prs[0]!.title = 'Revisions, pushed';
      s.prs[0]!.history = { events: [{ commit: h1 }, { commit: h2 }] };
    });
    await openAs(page, /Revisions, pushed/);
    await expect(diffText(page, 'two')).toBeVisible({ timeout: 30_000 });

    // The dialog hands the keyboard back to the selector, however it
    // closes: the option that opened it is gone.
    const dialog = page.getByRole('dialog', { name: 'Compare two revisions' });
    // By keyboard: the Enter that chooses the option does not open a list
    // over the dialog, and one Escape closes it.
    await selector(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    // The list takes the keyboard once it is placed, and a typed match
    // a moment after each key: Enter chooses whichever option has it.
    await expect(
      page.getByRole('option', { name: /All changes/, selected: true })
    ).toBeFocused();
    await page.keyboard.type('Choose');
    await expect(
      page.getByRole('option', { name: /Choose revisions/ })
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(selector(page)).toBeFocused();
    await choose(page, /Choose revisions/);
    await dialog.getByRole('button', { name: 'Compare' }).click();
    await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
    await expect(selector(page)).toBeFocused();

    // Left for two other tabs, so its pane is no longer the spare and
    // mounts again when it comes back: the same revisions.
    await tab(page, /Revisions, pushed/).dblclick();
    for (const branch of ['elsewhere', 'further']) {
      await sidebarRow(page, new RegExp(branch)).click();
      await tab(page, new RegExp(branch)).dblclick();
      await expect(diffText(page, branch)).toBeVisible({ timeout: 30_000 });
    }
    await tab(page, /Revisions, pushed/).click();
    await expect(selector(page)).toHaveText(/Chosen revisions/, {
      timeout: 30_000,
    });
    await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
    await expect(diffText(page, 'one')).toHaveCount(0);

    // Closed and opened again — a new pane: the same revisions, held
    // with its pinned head rather than with the tab.
    await tab(page, /Revisions, pushed/)
      .getByLabel('Close tab')
      .click();
    await expect(tab(page, /Revisions, pushed/)).toHaveCount(0);
    await openAs(page, /Revisions, pushed/);
    await expect(selector(page)).toHaveText(/Chosen revisions/, {
      timeout: 30_000,
    });
    await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);
    await expect(diffText(page, 'one')).toHaveCount(0);
  });
});

test('a history GitHub failed to send can be read again', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const h1 = git(repoPath, 'rev-parse', BRANCH);
  const h2 = push(repoPath, 'b.txt', 'two\n');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, pushed';
    s.prs[0]!.history = { reviews: [{ commit: h1 }] };
    s.prs[0]!.failing = { history: true };
  });
  await openAs(page, /Revisions, pushed/);
  await expect(diffText(page, 'two')).toBeVisible({ timeout: 30_000 });
  await choose(page, /Since your last review/);
  const retry = page.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible({ timeout: 30_000 });

  // GitHub answers again: the range reads, and the keyboard is on the
  // selector once the notice goes.
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.failing = {};
  });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`, {
    timeout: 30_000,
  });
  await expect(selector(page)).toBeFocused();
});

test('a comment numbered for the head stays off a range that ends before it', async ({
  desktop,
}) => {
  const { page, repoPath, homeDir } = desktop;
  const worktree = worktreeOf(repoPath);
  const h1 = git(repoPath, 'rev-parse', BRANCH);
  const edit = (text: string) => {
    writeFileSync(join(worktree, 'a.txt'), text);
    git(worktree, 'commit', '-q', '-am', 'edit a.txt');
    return git(worktree, 'rev-parse', 'HEAD');
  };
  const h2 = edit('one\ntwo\n');
  const h3 = edit('intro\none\ntwo\n');
  updateFakeGh(homeDir, (s) => {
    s.prs[0]!.title = 'Revisions, edited';
    s.prs[0]!.history = {
      events: [{ commit: h1 }, { commit: h2 }, { commit: h3 }],
    };
    // Line 2 at the head is "one"; at H2 it is "two".
    s.prs[0]!.threads = [
      {
        path: 'a.txt',
        line: 2,
        side: 'RIGHT',
        comments: [{ author: 'reviewer', body: 'About the line one.' }],
      },
    ];
  });
  await openAs(page, /Revisions, edited/);
  const diff = page.locator('[data-diff-scroll]');
  await expect(diff.getByText('About the line one.')).toBeVisible({
    timeout: 30_000,
  });

  await choose(page, /Choose revisions/);
  const dialog = page.getByRole('dialog', { name: 'Compare two revisions' });
  await dialog.getByLabel('From').click();
  await page.getByRole('option', { name: new RegExp(short(h1)) }).click();
  await dialog.getByLabel('To').click();
  await page.getByRole('option', { name: new RegExp(short(h2)) }).click();
  await dialog.getByRole('button', { name: 'Compare' }).click();
  await expect(bounds(page)).toHaveText(`${short(h1)} → ${short(h2)}`);

  // Not under H2's line 2: with the comments whose lines are not here.
  const orphans = diff
    .getByText('Comments on lines not in this diff')
    .locator('..');
  await expect(orphans).toContainText('About the line one.', {
    timeout: 30_000,
  });
});

test.describe('a pull request opened behind another tab', () => {
  test.skip(!tmuxAvailable(), 'tmux is not installed');
  const branches: string[] = [];
  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, branches, desktop.homeDir);
  });

  test('records no visit until its diff is in front of the reader', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await openAs(page, /Revisions/);
    await expect(diffText(page, 'one')).toBeVisible({ timeout: 30_000 });

    // An agent started from a shell opens its pull request's tab behind
    // this one, on its terminal.
    const branch = uniqueExternalBranch();
    branches.push(branch);
    const worktree = addExternalWorktree(repoPath, branch);
    writeFileSync(join(worktree, 'c.txt'), 'three\n');
    git(worktree, 'add', 'c.txt');
    git(worktree, 'commit', '-q', '-m', 'add c.txt');
    const head = git(worktree, 'rev-parse', 'HEAD');
    updateFakeGh(homeDir, (s) => {
      s.prs.push({ number: 22, title: 'Behind', headRefName: branch });
    });
    await expect(sidebarRow(page, /Behind/)).toBeVisible({ timeout: 30_000 });
    startExternalTmuxSession({
      repoPath,
      homeDir,
      branch,
      worktreePath: worktree,
      command: 'sleep 120',
    });
    const behind = tab(page, /Behind/);
    await expect(behind).toHaveAttribute('data-unseen', 'true', {
      timeout: 30_000,
    });

    // Opened, it shows the agent; its files are listed in the rail.
    await behind.click();
    const tree = page.locator('[data-file-tree]').filter({ visible: true });
    await expect(tree.getByRole('button', { name: /c\.txt/ })).toBeVisible({
      timeout: 30_000,
    });
    expect(recordedVisits(homeDir, 22)).toEqual([]);

    // The diff, in front: now it is a visit.
    await tree.getByRole('button', { name: /c\.txt/ }).click();
    await expect(diffText(page, 'three')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => recordedVisits(homeDir, 22), { timeout: 30_000 })
      .toEqual([head]);
  });
});
