import { describe, expect, it, vi } from 'vitest';
import { isVcsError } from '@n10/vcs-core';
import { readGitHubRevisions, REVISIONS_QUERY } from './pr-revisions.js';

/**
 * The GraphQL answers below have the shape GitHub's schema documents
 * for `timelineItems`, `reviews` and `viewer`; ids are made up.
 */

const oid = (c: string) => c.repeat(40);
const PROJECT = { owner: 'octocat', repo: 'hello' };

function answer(pullRequest: unknown, login: string | null = 'octocat') {
  return {
    data: {
      viewer: login === null ? null : { login },
      repository: {
        id: 'R_kgDOfixture',
        pullRequest:
          pullRequest === null
            ? null
            : {
                timelineItems: {
                  pageInfo: { hasPreviousPage: false },
                  nodes: [],
                },
                reviews: { pageInfo: { hasPreviousPage: false }, nodes: [] },
                ...(pullRequest as object),
              },
      },
    },
  };
}

const TIMELINE = {
  pageInfo: { hasPreviousPage: false },
  nodes: [
    {
      __typename: 'PullRequestCommit',
      commit: { oid: oid('1'), committedDate: '2026-01-01T00:00:00Z' },
    },
    {
      __typename: 'HeadRefForcePushedEvent',
      createdAt: '2026-01-02T00:00:00Z',
      beforeCommit: { oid: oid('1') },
      afterCommit: { oid: oid('2') },
    },
    // A commit GitHub no longer resolves, and a node it left empty.
    { __typename: 'PullRequestCommit', commit: null },
    null,
  ],
};

const review = (
  mine: boolean,
  head: string,
  at: string,
  extra: Record<string, unknown> = {}
) => ({
  state: 'APPROVED',
  body: '',
  viewerDidAuthor: mine,
  submittedAt: at,
  commit: { oid: oid(head) },
  comments: { totalCount: 0, nodes: [] },
  ...extra,
});

/** How GitHub sends a reply to a thread: a review of its own. */
const reply = (head: string, at: string) =>
  review(true, head, at, {
    state: 'COMMENTED',
    comments: { totalCount: 1, nodes: [{ replyTo: { id: 'PRRC_1' } }] },
  });

describe('readGitHubRevisions', () => {
  it('reads commits and force-pushes in order, and the viewer’s latest submitted review', async () => {
    const graphql = vi.fn().mockResolvedValue(
      answer({
        timelineItems: TIMELINE,
        reviews: {
          pageInfo: { hasPreviousPage: false },
          nodes: [
            review(true, '1', '2026-01-01T12:00:00Z'),
            // Someone else's, later: not the viewer's last review.
            review(false, '2', '2026-01-03T00:00:00Z'),
            // The viewer's reply to a thread: not a review.
            reply('2', '2026-01-04T00:00:00Z'),
          ],
        },
      })
    );
    const revisions = await readGitHubRevisions(graphql, PROJECT, 42);
    expect(graphql).toHaveBeenCalledWith(REVISIONS_QUERY, {
      owner: 'octocat',
      name: 'hello',
      number: 42,
    });
    expect(revisions).toEqual({
      ref: {
        provider: 'github',
        host: 'github.com',
        repository: 'octocat/hello',
        number: 42,
        id: 'R_kgDOfixture',
      },
      events: [
        { kind: 'commit', head: oid('1'), at: '2026-01-01T00:00:00Z' },
        {
          kind: 'force-push',
          before: oid('1'),
          head: oid('2'),
          at: '2026-01-02T00:00:00Z',
        },
      ],
      // A commit GitHub no longer resolves leaves a gap.
      complete: false,
      viewer: 'octocat',
      lastReview: { head: oid('1'), at: '2026-01-01T12:00:00Z' },
      reviewsComplete: true,
    });
  });

  it('asks only for submitted reviews, so a pending one cannot hide the last', () => {
    expect(REVISIONS_QUERY).toContain(
      'states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED]'
    );
  });

  // Each case: an older review on '1', then the one under test on '2',
  // the viewer's newest. Skipping it wrongly reports '1'.
  const lastOf = async (newest: Record<string, unknown>) => {
    const graphql = vi.fn().mockResolvedValue(
      answer({
        reviews: {
          pageInfo: { hasPreviousPage: false },
          nodes: [
            review(true, '1', 'a'),
            review(true, '2', 'b', { state: 'COMMENTED', ...newest }),
          ],
        },
      })
    );
    return (await readGitHubRevisions(graphql, PROJECT, 42)).lastReview;
  };
  const replies = (n: number, total = n) => ({
    totalCount: total,
    nodes: Array.from({ length: n }, () => ({ replyTo: { id: 'PRRC_1' } })),
  });

  it('skips a lone reply to a thread', async () => {
    expect((await lastOf({ comments: replies(1) }))?.head).toBe(oid('1'));
  });

  it.each([
    [
      'a comment that starts a thread',
      { comments: { totalCount: 1, nodes: [{ replyTo: null }] } },
    ],
    ['a reply with a summary', { body: 'Looks close.', comments: replies(1) }],
    ['several replies submitted at once', { comments: replies(2) }],
    ['more comments than were read', { comments: replies(1, 21) }],
    ['a summary alone', { body: 'Looks close.' }],
  ])('counts %s as a review', async (_, newest) => {
    expect((await lastOf(newest))?.head).toBe(oid('2'));
  });

  it('never lets an older review stand in for one with no commit', async () => {
    expect(await lastOf({ body: 'Looks close.', commit: null })).toEqual({
      head: null,
      at: 'b',
    });
  });

  it('says reviews before the page were not read', async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue(
        answer({ reviews: { pageInfo: { hasPreviousPage: true }, nodes: [] } })
      );
    const revisions = await readGitHubRevisions(graphql, PROJECT, 42);
    expect(revisions).toMatchObject({
      lastReview: null,
      reviewsComplete: false,
    });
  });

  it('has no last review when the viewer never submitted one', async () => {
    const graphql = vi.fn().mockResolvedValue(
      answer({
        reviews: {
          pageInfo: { hasPreviousPage: false },
          nodes: [review(false, '1', 'x')],
        },
      })
    );
    const revisions = await readGitHubRevisions(graphql, PROJECT, 42);
    expect(revisions.lastReview).toBeNull();
  });

  it('says the history is incomplete when commits or force-pushes came before the page', async () => {
    const graphql = vi.fn().mockResolvedValue(
      answer({
        timelineItems: { ...TIMELINE, pageInfo: { hasPreviousPage: true } },
      })
    );
    const revisions = await readGitHubRevisions(graphql, PROJECT, 42);
    expect(revisions.complete).toBe(false);
  });

  it('is not-found for a pull request GitHub does not have', async () => {
    const graphql = vi.fn().mockResolvedValue(answer(null));
    const read = readGitHubRevisions(graphql, PROJECT, 42);
    await expect(read).rejects.toSatisfy(
      (e: unknown) => isVcsError(e) && e.kind === 'not-found'
    );
  });
});
