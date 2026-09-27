import type { FakePr, FakeThread } from '../setup/fake-gh.js';

/**
 * The Q2 conversation fixture: 130 review threads, one of them with 125
 * replies, 150 conversation comments and three submitted reviews — one
 * a summary with no inline comments. The fake `gh` pages every one of
 * these a hundred at a time, as GitHub does.
 */
export const Q2_COUNTS = {
  threads: 130,
  longThreadReplies: 125,
  comments: 150,
  reviews: 3,
} as const;

export function q2Conversation(): Pick<
  FakePr,
  'threads' | 'generalComments' | 'reviews'
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
  return {
    threads,
    generalComments: Array.from({ length: Q2_COUNTS.comments }, (_, i) => ({
      author: i % 2 ? 'alex' : 'bea',
      body: `general ${i + 1}`,
    })),
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
