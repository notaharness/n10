import { twoDaysAgoAt as at, type FakePr } from '../setup/fake-gh.js';

/**
 * A pull request's conversation as a reviewer meets it: a summary-only
 * approval, a changes-requested review, open, resolved, outdated
 * left-side and file-level threads, a long thread, a bot's comment,
 * and pushes and a team review request between them. Small enough to
 * read in a screenshot; `conversation-q2.ts` is the one for counts.
 */

const alex = { __typename: 'User', login: 'alex' };

export const REVIEW_FILES = {
  'src/request.ts': [
    'export function run(token: Token) {',
    '  const timer = start();',
    '  if (token.cancelled) return;',
    '  send(token);',
    '  timer.stop();',
    '}',
    '',
  ].join('\n'),
  'assets/logo.png': 'not really a png\n',
};

export function reviewConversation(): Pick<
  FakePr,
  'threads' | 'generalComments' | 'reviews' | 'events'
> {
  return {
    events: [
      {
        __typename: 'PullRequestCommit',
        id: 'commit-1',
        commit: {
          oid: 'a1b2c3d'.padEnd(40, '0'),
          committedDate: at(9),
          messageHeadline: 'Handle cancelled requests',
          author: { name: 'Alex', user: alex },
        },
      },
      {
        __typename: 'PullRequestCommit',
        id: 'commit-2',
        commit: {
          oid: 'b2c3d4e'.padEnd(40, '0'),
          committedDate: at(9, 5),
          messageHeadline: 'Stop the timer on cancel',
          author: { name: 'Alex', user: alex },
        },
      },
      {
        __typename: 'ReviewRequestedEvent',
        id: 'request-1',
        createdAt: at(9, 10),
        actor: alex,
        requestedReviewer: {
          __typename: 'Team',
          name: 'Core',
          combinedSlug: 'n10/core',
        },
      },
      {
        __typename: 'HeadRefForcePushedEvent',
        id: 'push-1',
        createdAt: at(12),
        actor: alex,
        beforeCommit: { oid: 'b2c3d4e'.padEnd(40, '0') },
        afterCommit: { oid: 'e4f5a6b'.padEnd(40, '0') },
      },
    ],
    generalComments: [
      {
        author: 'alex',
        body: 'Cancelled requests used to leak their timer. This stops it.',
        createdAt: at(9, 15),
      },
      {
        author: 'ci-bot',
        body: 'Coverage: 91.4% (+0.2%)',
        createdAt: at(9, 20),
      },
    ],
    reviews: [
      {
        author: 'bea',
        state: 'CHANGES_REQUESTED',
        body: 'The cleanup path needs a test before this goes in.',
        commentCount: 2,
        submittedAt: at(10),
      },
      {
        author: 'dan',
        state: 'APPROVED',
        body: 'Read it end to end — looks right.',
        submittedAt: at(13),
      },
    ],
    threads: [
      {
        id: 'T-open',
        path: 'src/request.ts',
        line: 3,
        diffHunk: [
          '@@ -1,4 +1,5 @@',
          ' export function run(token: Token) {',
          '   const timer = start();',
          '+  if (token.cancelled) return;',
        ].join('\n'),
        comments: [
          {
            author: 'bea',
            body: 'Does an early return here skip `timer.stop()`?',
            createdAt: at(10, 1),
          },
          {
            author: 'alex',
            body: 'It did — fixed in the next push.',
            createdAt: at(11),
          },
        ],
      },
      {
        id: 'T-outdated',
        path: 'src/request.ts',
        originalLine: 4,
        side: 'LEFT',
        isOutdated: true,
        diffHunk: [
          '@@ -2,3 +2,3 @@',
          '   const timer = start();',
          '-  send(token, { retry: true });',
        ].join('\n'),
        comments: [
          {
            author: 'bea',
            body: 'Why drop the retry?',
            createdAt: at(10, 2),
          },
        ],
      },
      {
        id: 'T-resolved',
        path: 'src/request.ts',
        line: 5,
        isResolved: true,
        resolvedBy: 'alex',
        comments: [
          {
            author: 'bea',
            body: 'Nit: name this `stopTimer`.',
            createdAt: at(10, 3),
          },
        ],
      },
      {
        id: 'T-file',
        path: 'assets/logo.png',
        comments: [
          {
            author: 'bea',
            body: 'Can this be generated instead of checked in?',
            createdAt: at(10, 4),
          },
        ],
      },
      {
        id: 'T-long',
        path: 'src/request.ts',
        line: 1,
        comments: [
          {
            author: 'alex',
            body: 'Should `run` take a signal instead?',
            createdAt: at(11, 30),
          },
          ...Array.from({ length: 9 }, (_, i) => ({
            author: i % 2 ? 'alex' : 'bea',
            body:
              i === 4
                ? 'An AbortSignal would be the needle here.'
                : `Discussion ${i + 1}.`,
            createdAt: at(11, 31 + i),
          })),
        ],
      },
    ],
  };
}
