import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { updateFakeGh, type FakeGitHub } from './setup/fake-gh.js';

/**
 * The selected pull request's detail, read through the whole stack the
 * Overview will use: the bridge, the host's identity checks, the GitHub
 * provider and `gh`. Nothing renders it yet, so this asks the bridge
 * directly.
 */

const GITHUB: FakeGitHub = {
  username: 'n10-tester',
  prs: [
    {
      number: 214,
      title: 'Handle cancelled requests',
      headRefName: 'cancel-requests',
      author: 'alex',
      fork: 'alex/fixture',
      // A reply in a thread, after the approval, is a COMMENTED review.
      reviews: [
        { author: 'bea', state: 'APPROVED' },
        { author: 'bea', state: 'COMMENTED' },
      ],
      reviewRequests: ['n10-tester'],
    },
    {
      number: 215,
      title: 'Tidy the retry helper',
      headRefName: 'tidy-retry',
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

interface Bridge {
  n10: { getPullRequestSnapshot(req: unknown): Promise<unknown> };
}

function snapshot(page: Page, viewer: string | null, number = REF.number) {
  return page.evaluate(
    (req) => (window as unknown as Bridge).n10.getPullRequestSnapshot(req),
    { ref: { ...REF, number }, viewer }
  );
}

interface Read {
  ref: { id: string };
  detail: { value: { source: { repository: { id: string } } } };
}

test.describe('Selected pull request detail', () => {
  test('reads identity, fork and reviewers from GitHub', async ({
    desktop,
  }) => {
    await expect(snapshot(desktop.page, 'n10-tester')).resolves.toMatchObject({
      ref: { ...REF, id: expect.stringMatching(/^\d+$/) as unknown },
      viewer: 'n10-tester',
      head: { from: 'detail' },
      detail: {
        state: 'read',
        value: {
          lifecycle: { state: 'open', native: 'OPEN' },
          source: {
            branch: 'cancel-requests',
            repository: { repository: 'alex/fixture' },
          },
          reviewers: {
            state: 'read',
            value: {
              complete: true,
              total: 2,
              items: [
                // The approval stands through the later comment.
                { identifier: 'bea', decision: 'approved', requested: false },
                {
                  identifier: 'n10-tester',
                  decision: 'no-response',
                  requested: true,
                },
              ],
            },
          },
          capabilities: { update: { state: 'supported' } },
        },
      },
    });
  });

  test('tells a fork from the repository by id', async ({ desktop }) => {
    const fork = (await snapshot(desktop.page, 'n10-tester')) as Read;
    const own = (await snapshot(desktop.page, 'n10-tester', 215)) as Read;
    expect(fork.detail.value.source.repository.id).not.toBe(fork.ref.id);
    expect(own.detail.value.source.repository.id).toBe(own.ref.id);
    expect(own.ref.id).toBe(fork.ref.id);
  });

  test('keeps the list row when the detail read fails', async ({ desktop }) => {
    updateFakeGh(desktop.homeDir, (scenario) => {
      scenario.prs[0].failing = { detail: true };
    });
    await expect(snapshot(desktop.page, 'n10-tester')).resolves.toMatchObject({
      summary: { kind: 'found' },
      detail: { state: 'failed', kind: 'server' },
      head: { from: 'list' },
    });
  });

  test('refuses to answer as another account', async ({ desktop }) => {
    await expect(snapshot(desktop.page, 'carol')).rejects.toThrow(
      'n10 acts as n10-tester now, not carol'
    );
  });
});
