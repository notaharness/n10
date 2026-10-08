import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';

/**
 * What stands between a pull request and merging, read through the
 * whole stack the Completion section uses: the bridge, the host's
 * identity checks, the GitHub provider and `gh`, asked directly. What
 * the section shows of it is `pr-completion.test.ts`.
 */

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  rules: { required: ['build', 'e2e'], conversationResolution: true },
  prs: [
    {
      number: 214,
      // The head the checks below are read on; this clone lacks it.
      headRefOid: 'f'.repeat(40),
      title: 'Handle cancelled requests',
      headRefName: 'cancel-requests',
      author: 'alex',
      mergeStateStatus: 'BLOCKED',
      reviewDecision: 'APPROVED',
      checks: [
        { name: 'build', state: 'FAILURE', required: true },
        { name: 'lint', state: 'IN_PROGRESS', required: true },
        { name: 'docs', state: 'FAILURE', required: false },
        { name: 'deploy/preview', state: 'SUCCESS', status: true },
      ],
      threads: [
        {
          path: 'src/request.ts',
          line: 1,
          comments: [{ author: 'bea', body: 'Is the timer cleared?' }],
        },
      ],
    },
    {
      number: 215,
      title: 'Tidy the retry helper',
      headRefName: 'tidy-retry',
      mergeStateStatus: 'CLEAN',
      checks: [
        { name: 'build', state: 'SUCCESS', required: true },
        { name: 'e2e', state: 'SUCCESS', required: true, event: 'push' },
      ],
    },
  ],
};

test.use({ fakeGitHub: GITHUB });

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'n10/fixture',
  number: 214,
};

function checks(page: Page, number = REF.number, viewer = 'n10-tester') {
  return page.evaluate(
    async (req) => {
      const repo = await window.n10.getRepo();
      if (!repo) throw new Error('no open repository');
      return window.n10.getPullRequestChecks(repo.cwd, req);
    },
    { ref: { ...REF, number }, viewer }
  );
}

test.describe('Selected pull request checks', () => {
  test('reads each check and names what blocks the merge, and who clears it', async ({
    desktop,
  }) => {
    await expect(checks(desktop.page)).resolves.toMatchObject({
      ref: REF,
      viewer: 'n10-tester',
      checks: {
        state: 'read',
        value: {
          head: 'f'.repeat(40),
          checks: {
            state: 'read',
            value: {
              complete: true,
              items: [
                {
                  name: 'build',
                  outcome: 'failed',
                  requirement: 'required',
                  ranOn: 'merge',
                },
                { name: 'lint', outcome: 'running', requirement: 'required' },
                { name: 'docs', outcome: 'failed', requirement: 'optional' },
                { name: 'deploy/preview', outcome: 'succeeded', ranOn: null },
                // Required by the rules, and reported by nothing yet.
                { name: 'e2e', outcome: 'expected', requirement: 'required' },
              ],
            },
          },
          rules: {
            state: 'read',
            value: { conversationResolution: true },
          },
          merge: { blocked: true, reviews: 'approved', native: 'BLOCKED' },
        },
      },
      readiness: {
        state: 'blocked',
        // What won't clear by waiting first.
        blockers: [
          {
            kind: 'checks',
            text: '1 required check failing: build',
            resolvedBy: 'author',
          },
          {
            kind: 'conversations',
            text: '1 unresolved conversation',
            resolvedBy: 'author',
          },
          {
            kind: 'checks',
            text: 'Waiting for 2 required checks: lint, e2e',
            resolvedBy: 'checks',
          },
        ],
        advisories: [
          {
            kind: 'checks',
            text: '1 check failing, not required: docs',
            resolvedBy: 'author',
          },
        ],
      },
    });
  });

  test('reads a pull request GitHub says is clean as ready', async ({
    desktop,
  }) => {
    await expect(checks(desktop.page, 215)).resolves.toMatchObject({
      checks: {
        value: {
          checks: {
            value: {
              items: [
                { name: 'build', ranOn: 'merge' },
                { name: 'e2e', ranOn: 'revision' },
              ],
            },
          },
        },
      },
      readiness: { state: 'ready', blockers: [], unknowns: [] },
    });
  });

  test('keeps GitHub’s verdict when the rules cannot be read, and says they were not', async ({
    desktop,
  }) => {
    updateFakeGh(desktop.homeDir, (s) => {
      s.rules = { ...s.rules, failing: true };
    });
    await expect(checks(desktop.page, 215)).resolves.toMatchObject({
      checks: { state: 'read', value: { rules: { state: 'failed' } } },
      readiness: { state: 'ready', unknowns: ['Branch rules'] },
    });
    // Blocked, with nothing read to say why: a rule n10 cannot see.
    await expect(checks(desktop.page)).resolves.toMatchObject({
      readiness: { state: 'blocked' },
    });
  });

  test('says the checks could not be read, rather than that there are none', async ({
    desktop,
  }) => {
    updateFakeGh(desktop.homeDir, (s) => {
      s.prs[0].failing = { checks: true };
    });
    // Readiness falls back to the list row, which never says ready.
    await expect(checks(desktop.page)).resolves.toMatchObject({
      checks: { state: 'failed' },
      readiness: { state: 'unknown' },
      list: null,
    });
  });

  test('refuses a caller that last saw another account', async ({
    desktop,
  }) => {
    await expect(
      checks(desktop.page, REF.number, 'someone-else')
    ).rejects.toThrow(/The account changed from someone-else to n10-tester/);
  });
});
