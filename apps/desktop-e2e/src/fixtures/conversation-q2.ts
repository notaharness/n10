import {
  twoDaysAgoAt,
  type FakePr,
  type FakeThread,
} from '../setup/fake-gh.js';

/**
 * The Q2 conversation fixture: 130 review threads, one of them with 125
 * replies, 150 conversation comments and three submitted reviews — one
 * a summary with no inline comments — among resolved, outdated
 * left-side and file-level threads, a bot's comment, and pushes and a
 * team review request in the timeline. The fake `gh` pages every one of
 * these a hundred at a time, as GitHub does.
 */
export const Q2_COUNTS = {
  threads: 130,
  longThreadReplies: 125,
  comments: 150,
  reviews: 3,
  events: 3,
} as const;

export function q2Conversation(): Pick<
  FakePr,
  'threads' | 'generalComments' | 'reviews' | 'events'
> {
  const threads: FakeThread[] = Array.from(
    { length: Q2_COUNTS.threads },
    (_, i) => ({
      id: `thread-${i + 1}`,
      path: 'README.md',
      line: 1,
      comments: [{ author: 'bea', body: `thread ${i + 1}` }],
    })
  );
  const long = threads[6]!;
  for (let r = 1; r <= Q2_COUNTS.longThreadReplies; r++) {
    long.comments.push({ author: r % 2 ? 'alex' : 'bea', body: `reply ${r}` });
  }
  threads[0] = { ...threads[0]!, isResolved: true, resolvedBy: 'alex' };
  threads[1] = {
    ...threads[1]!,
    line: undefined,
    originalLine: 3,
    side: 'LEFT',
    isOutdated: true,
  };
  threads[2] = { ...threads[2]!, path: 'logo.png', line: undefined };
  const at = (min: number) => twoDaysAgoAt(9, min);
  const alex = { __typename: 'User', login: 'alex' };
  return {
    threads,
    generalComments: Array.from({ length: Q2_COUNTS.comments }, (_, i) => ({
      author: i === 0 ? 'ci-bot' : i % 2 ? 'alex' : 'bea',
      body: `general ${i + 1}`,
    })),
    events: [
      {
        __typename: 'PullRequestCommit',
        id: 'commit-1',
        commit: {
          oid: '1'.repeat(40),
          committedDate: at(0),
          messageHeadline: 'Start the conversation',
          author: { name: 'Alex', user: alex },
        },
      },
      {
        __typename: 'HeadRefForcePushedEvent',
        id: 'push-1',
        createdAt: at(5),
        actor: alex,
        beforeCommit: { oid: '1'.repeat(40) },
        afterCommit: { oid: '2'.repeat(40) },
      },
      {
        __typename: 'ReviewRequestedEvent',
        id: 'request-1',
        createdAt: at(6),
        actor: alex,
        requestedReviewer: { __typename: 'Team', name: 'Core' },
      },
    ],
    reviews: [
      { author: 'bea', state: 'COMMENTED', body: 'Questions inline.' },
      { author: 'carol', state: 'CHANGES_REQUESTED', body: 'Needs cleanup.' },
      {
        author: 'dan',
        state: 'APPROVED',
        body: 'Summary only: looks right.',
        commentCount: 0,
      },
    ],
  };
}
