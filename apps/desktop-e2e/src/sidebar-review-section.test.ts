import type { Locator, Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  fakeAdoProjectConfig,
  installFakeAdo,
  type FakeAzureDevOps,
} from './setup/fake-ado.js';
import { launchAgentFromRail, sidebar, visibleText } from './setup/app.js';

/**
 * A pull request's sidebar section says whose it is and where its
 * review stands, and nothing local moves it: someone else's pull
 * request stays in its review section once you check it out and start
 * an agent on it, and that row carries the agent. One that is waiting
 * on nobody's review of yours files with the worktrees, never under
 * your own pull requests.
 */

const BRANCH = 'cancel-requests';

const section = (page: Page, name: string) =>
  sidebar(page).getByRole('group', { name });

/** Open the row's pull request and start an agent in a new worktree. */
async function startAgentOn(page: Page, row: Locator) {
  await row.click();
  await launchAgentFromRail(page);
  await expect(visibleText(page, 'n10-fake-agent-ready')).toBeVisible({
    timeout: 30_000,
  });
}

/** The pull request's one row, in `name`, carrying its running agent. */
async function expectRowIn(page: Page, name: string, pr: RegExp) {
  const row = section(page, name).getByRole('button', { name: pr });
  await expect(row.locator('[data-agent-running]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(sidebar(page).getByRole('button', { name: pr })).toHaveCount(1);
  await expect(section(page, 'Pull Requests')).toHaveCount(0);
}

test.describe('on GitHub', () => {
  test.use({
    fakeGitHub: {
      username: 'n10-tester',
      prs: [
        {
          number: 214,
          title: 'Handle cancelled requests',
          headRefName: BRANCH,
          author: 'alex',
          reviewRequests: ['n10-tester'],
        },
        {
          number: 215,
          title: 'Retry dropped uploads',
          headRefName: 'retry-uploads',
          author: 'alex',
        },
      ],
    },
    repo: { branches: [BRANCH], worktrees: [{ branch: 'retry-uploads' }] },
    n10Config: { aiCommand: fakeAgent() },
  });

  test('a review request keeps its section once an agent works on it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const row = section(page, 'Needs Your Review').getByRole('button', {
      name: /#214/,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await startAgentOn(page, row);
    await expectRowIn(page, 'Needs Your Review', /#214/);
  });

  test('a checkout of someone else’s pull request you were not asked to review is a worktree', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const row = section(page, 'Worktrees').getByRole('button', {
      name: /Retry dropped uploads/,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await startAgentOn(page, row);
    await expectRowIn(page, 'Worktrees', /Retry dropped uploads/);
  });
});

test.describe('on Azure DevOps', () => {
  const scenario = (teamVote: 0 | 10): FakeAzureDevOps => ({
    project: 'Fabrikam',
    user: {
      displayName: 'Robin Tester',
      uniqueName: 'robin.tester@example.com',
    },
    teams: ['Team DES'],
    prs: [
      {
        id: 4211,
        title: 'Handle cancelled requests',
        sourceBranch: BRANCH,
        author: 'Alex Doe',
        reviewers: [
          { name: 'Team DES', isContainer: true, vote: teamVote },
          ...(teamVote ? [{ name: 'Harrie Essing', vote: teamVote }] : []),
        ],
      },
    ],
  });

  test.use({
    fakeAzureDevOps: scenario(0),
    repo: { branches: [BRANCH] },
    n10Config: { aiCommand: fakeAgent() },
  });

  test('a request to your team keeps its section, then files with the worktrees once a teammate answers it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const row = section(page, 'Needs Your Review').getByRole('button', {
      name: /#4211/,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await startAgentOn(page, row);
    await expectRowIn(page, 'Needs Your Review', /#4211/);

    // A teammate approves for the team: the request is answered, and
    // the pull request was never yours.
    installFakeAdo(desktop.homeDir, scenario(10));
    await sidebar(page).getByRole('button', { name: 'Refresh' }).click();
    await expect(section(page, 'Needs Your Review')).toHaveCount(0, {
      timeout: 15_000,
    });
    await expectRowIn(page, 'Worktrees', /#4211/);
  });
});

test.describe('on Azure DevOps, with a git email that is not the account’s', () => {
  // Git says who commits; Azure says who is signed in. Your pull
  // request is yours by the account that wrote it, not by the email.
  const own: FakeAzureDevOps = {
    project: 'Fabrikam',
    user: { displayName: 'Robin Tester', uniqueName: 'CORP\\robin.tester' },
    prs: [{ id: 4212, title: 'Drain the upload queue', sourceBranch: BRANCH }],
  };

  test.use({
    fakeAzureDevOps: own,
    projectConfig: {
      ...fakeAdoProjectConfig(own),
      email: 'robin@personal.example',
    },
    repo: { branches: [BRANCH] },
    n10Config: { aiCommand: fakeAgent() },
  });

  test('your own pull request stays under Pull Requests once an agent works on it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const row = section(page, 'Pull Requests').getByRole('button', {
      name: /#4212/,
    });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await startAgentOn(page, row);
    const mine = section(page, 'Pull Requests').getByRole('button', {
      name: /#4212/,
    });
    await expect(mine.locator('[data-agent-running]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(section(page, 'Worktrees')).toHaveCount(0);
  });
});
