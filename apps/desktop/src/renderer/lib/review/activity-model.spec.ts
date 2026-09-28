import { describe, expect, it } from 'vitest';
import type {
  ConversationActor,
  ConversationComment,
  ConversationEvent,
  ConversationThread,
  PullRequestConversation,
  ReviewSummary,
} from '../../../host/contract.js';
import {
  buildActivity,
  filterCounts,
  groupActivity,
  isResolved,
  matchingComments,
  resolvedIds,
  rowContaining,
  selectActivity,
  splitNew,
  withoutHidden,
  withoutResolved,
} from './activity-model.js';

const DONE = { loaded: 0, total: 0, complete: true };
const SUPPORTED = { state: 'supported' } as const;

const person = (login: string, kind: ConversationActor['kind'] = 'user') => ({
  identifier: login,
  displayName: login,
  id: null,
  kind,
});

function comment(
  id: string,
  author: string,
  body: string,
  at: string,
  kind: ConversationActor['kind'] = 'user'
): ConversationComment {
  return {
    id,
    author: person(author, kind),
    source: body,
    body,
    kind: 'text',
    deleted: false,
    createdAt: at,
    editedAt: null,
    minimized: null,
    pending: false,
    replyTo: null,
    reviewId: null,
    url: null,
    capabilities: { edit: SUPPORTED, delete: SUPPORTED },
  };
}

function thread(
  id: string,
  comments: ConversationComment[],
  over: Partial<ConversationThread> = {}
): ConversationThread {
  return {
    id,
    scope: 'line',
    anchor: {
      path: 'src/request.ts',
      current: { startSide: 'RIGHT', start: 41, side: 'RIGHT', end: 41 },
      original: null,
      originalPath: null,
      originalCommit: null,
      iterations: null,
      diffHunk: null,
    },
    isOutdated: false,
    status: { resolved: false, native: 'unresolved', resolvedBy: null },
    comments,
    coverage: DONE,
    capabilities: { reply: SUPPORTED, resolve: SUPPORTED },
    ...over,
  };
}

function review(id: string, author: string, at: string | null): ReviewSummary {
  return {
    id,
    author: person(author),
    state: 'approved',
    native: 'APPROVED',
    source: 'Looks right.',
    body: 'Looks right.',
    submittedAt: at,
    commit: null,
    commentCount: 0,
    minimized: null,
    url: null,
  };
}

function commit(id: string, at: string, author = 'alex'): ConversationEvent {
  return {
    id,
    kind: 'commit',
    actor: person(author),
    at,
    native: 'PullRequestCommit',
    commit: id.padEnd(40, '0'),
    headline: `commit ${id}`,
    authorName: null,
  };
}

function system(
  id: string,
  at: string,
  actor: ConversationActor | null = null
): ConversationEvent {
  return { id, kind: 'system', actor, at, native: 'x', text: 'noise' };
}

/** An Azure DevOps pull request's conversation shape. */
const ADO_REF = {
  provider: 'azure-devops',
  host: 'dev.azure.com/acme',
  repository: 'Shop/web',
  number: 7,
};

function conversation(
  over: Partial<PullRequestConversation>
): PullRequestConversation {
  return {
    ref: {
      provider: 'github',
      host: 'github.com',
      repository: 'a/b',
      number: 1,
    },
    threads: [],
    comments: [],
    reviews: [],
    events: [],
    coverage: {
      threads: DONE,
      threadComments: DONE,
      comments: DONE,
      reviews: DONE,
      events: DONE,
    },
    ...over,
  };
}

const T = (h: number) => `2026-09-20T${String(h).padStart(2, '0')}:00:00Z`;

describe('buildActivity', () => {
  it('orders every kind of record by its time, oldest first', () => {
    const entries = buildActivity(
      conversation({
        reviews: [review('r1', 'bea', T(5))],
        comments: [comment('g1', 'alex', 'hello', T(1))],
        threads: [thread('t1', [comment('t1c1', 'bea', 'why?', T(3))])],
        events: [commit('c1', T(2))],
      })
    );
    expect(entries.map((e) => e.id)).toEqual(['g1', 'c1', 't1', 'r1']);
  });

  it('leaves out a review that only carries replies, and keeps one that started threads', () => {
    const empty = (id: string, at: string): ReviewSummary => ({
      ...review(id, 'bea', at),
      state: 'commented',
      body: ' ',
    });
    const of = (id: string, reviewId: string, replyTo: string | null) => ({
      ...comment(id, 'bea', 'text', T(1)),
      reviewId,
      replyTo,
    });
    const entries = buildActivity(
      conversation({
        reviews: [
          empty('carrier', T(1)),
          empty('started', T(2)),
          { ...review('said', 'bea', T(3)), state: 'commented' },
          { ...review('verdict', 'bea', T(4)), body: '' },
        ],
        threads: [
          thread('t1', [
            of('root1', 'started', null),
            of('re1', 'carrier', 'root1'),
          ]),
        ],
      })
    );
    expect(entries.filter((e) => e.kind === 'review').map((e) => e.id)).toEqual(
      ['started', 'said', 'verdict']
    );
  });

  it('puts an undated review (the viewer’s pending one) last', () => {
    const entries = buildActivity(
      conversation({
        reviews: [review('mine', 'me', null)],
        comments: [comment('g1', 'alex', 'hi', T(1))],
      })
    );
    expect(entries.map((e) => e.id)).toEqual(['g1', 'mine']);
  });
});

describe('groupActivity', () => {
  it('reads one author’s commits in a row as one entry, and a lone commit as itself', () => {
    const rows = groupActivity(
      buildActivity(
        conversation({
          events: [commit('a', T(1)), commit('b', T(2)), commit('c', T(4))],
          comments: [comment('g1', 'bea', 'between', T(3))],
        })
      )
    );
    expect(rows.map((r) => r.kind)).toEqual(['commits', 'comment', 'event']);
    expect(rows[0]).toMatchObject({ events: [{ id: 'a' }, { id: 'b' }] });
  });

  it('never credits one author’s commits to another', () => {
    const rows = groupActivity(
      buildActivity(
        conversation({
          events: [
            commit('a', T(1)),
            commit('b', T(2), 'bea'),
            commit('c', T(3), 'bea'),
          ],
        })
      )
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'commits:b']);
  });

  it('folds bot comments and provider noise, and keeps people’s entries apart', () => {
    const rows = groupActivity(
      buildActivity(
        conversation({
          comments: [
            comment('bot1', 'ci-bot', 'coverage 91%', T(1), 'bot'),
            comment('bot2', 'ci-bot', 'coverage 92%', T(3), 'bot'),
            comment('human', 'bea', 'thanks', T(4)),
          ],
          events: [system('s1', T(2))],
        })
      )
    );
    expect(rows.map((r) => r.kind)).toEqual(['automation', 'comment']);
    expect(rows[0]).toMatchObject({
      entries: [{ id: 'bot1' }, { id: 's1' }, { id: 'bot2' }],
    });
  });

  it('keeps history a person made in view, whatever the provider calls it', () => {
    // Azure's ReviewersUpdate is a system entry with a human actor.
    const rows = groupActivity(
      buildActivity(
        conversation({
          ref: ADO_REF,
          events: [
            system('reviewers', T(1), person('bea@acme.com')),
            system(
              'merge-check',
              T(2),
              person('Project Build Service', 'system')
            ),
          ],
        })
      )
    );
    expect(rows.map((r) => r.kind)).toEqual(['event', 'automation']);
  });

  it('finds the row that shows an entry, folded or not', () => {
    const rows = groupActivity(
      buildActivity(
        conversation({
          events: [commit('a', T(1)), commit('b', T(2))],
          comments: [
            comment('bot', 'ci-bot', 'coverage', T(3), 'bot'),
            comment('g1', 'bea', 'hi', T(4)),
          ],
        })
      )
    );
    expect(rowContaining(rows, 'b')).toBe('commits:a');
    expect(rowContaining(rows, 'bot')).toBe('auto:bot');
    expect(rowContaining(rows, 'g1')).toBe('g1');
    expect(rowContaining(rows, 'gone')).toBeNull();
  });
});

describe('selectActivity', () => {
  const entries = buildActivity(
    conversation({
      threads: [
        thread('open', [comment('o1', 'bea', 'why?', T(1))]),
        thread('done', [comment('d1', 'me', 'fixed', T(2))], {
          status: { resolved: true, native: 'resolved', resolvedBy: null },
        }),
        thread('old', [comment('x1', 'bea', 'stale', T(3))], {
          isOutdated: true,
        }),
      ],
      comments: [
        comment('ping', 'alex', 'cc @me, and not @menot', T(4)),
        comment('email', 'alex', 'mail me@example.com', T(5)),
        comment('code', 'alex', 'run `@me` or\n```\n@me\n```', T(5)),
      ],
      reviews: [review('r1', 'me', T(6))],
    })
  );
  const ids = (f: Parameters<typeof selectActivity>[1], q = '') =>
    selectActivity(entries, f, q, 'me').map((e) => e.id);

  it('keeps resolved and outdated independent', () => {
    expect(ids('open')).toEqual(['open', 'old']);
    expect(entries.filter(isResolved).map((e) => e.id)).toEqual(['done']);
    expect(ids('outdated')).toEqual(['old']);
  });

  it('keeps a thread resolved in view, and brings back one reopened', () => {
    const hidden = resolvedIds(entries);
    expect([...hidden]).toEqual(['done']);
    // Nothing was hidden on arrival: the thread resolved since stays.
    expect(withoutHidden(entries, new Set())).toHaveLength(entries.length);
    expect(withoutHidden(entries, hidden).map((e) => e.id)).not.toContain(
      'done'
    );
    // A hidden id that is no longer resolved shows again.
    expect(
      withoutHidden(entries, new Set(['open'])).map((e) => e.id)
    ).toContain('open');
  });

  it('hides resolved threads, and only those', () => {
    expect(withoutResolved(entries).map((e) => e.id)).toEqual([
      'open',
      'old',
      'ping',
      'email',
      'code',
      'r1',
    ]);
  });

  it('finds what the viewer wrote', () => {
    expect(ids('mine')).toEqual(['done', 'r1']);
  });

  it('counts each filter', () => {
    expect(filterCounts(entries, 'me')).toEqual({
      all: 7,
      open: 2,
      outdated: 1,
      mine: 2,
    });
  });

  it('has nothing for "mine" without an account', () => {
    expect(selectActivity(entries, 'mine', '', null)).toEqual([]);
  });

  it('searches bodies, authors and paths, case-insensitively', () => {
    expect(ids('all', 'STALE')).toEqual(['old']);
    expect(ids('all', 'request.ts')).toEqual(['open', 'done', 'old']);
    expect(ids('all', 'alex')).toEqual(['ping', 'email', 'code']);
  });

  it('searches the words an event line shows', () => {
    const events = buildActivity(
      conversation({
        events: [
          {
            id: 'rr',
            kind: 'review-requested',
            actor: person('alex'),
            at: T(1),
            native: 'ReviewRequestedEvent',
            reviewer: { kind: 'team', name: 'Core', handle: 'acme/core' },
          },
        ],
      })
    );
    expect(
      selectActivity(events, 'all', 'requested review', null)
    ).toHaveLength(1);
  });
});

describe('an Azure DevOps conversation', () => {
  const entries = buildActivity(
    conversation({
      ref: ADO_REF,
      threads: [
        thread(
          'general',
          [comment('g', 'bea@acme.com', 'Overall fine', T(1))],
          {
            scope: 'general',
            anchor: null,
          }
        ),
        thread('fixed', [comment('f', 'bea@acme.com', 'typo', T(2))], {
          status: { resolved: true, native: 'fixed', resolvedBy: null },
        }),
        thread('wontfix', [comment('w', 'bea@acme.com', 'rename?', T(3))], {
          status: { resolved: true, native: 'wontFix', resolvedBy: null },
        }),
      ],
      events: [
        {
          id: 'vote',
          kind: 'vote',
          actor: person('me@acme.com'),
          at: T(4),
          native: 'VoteUpdate',
          vote: 10,
          text: null,
        },
      ],
    })
  );
  const ids = (f: Parameters<typeof selectActivity>[1]) =>
    selectActivity(entries, f, '', 'ME@acme.com').map((e) => e.id);

  it('files general threads by their status like any other', () => {
    expect(ids('open')).toEqual(['general']);
    expect(entries.filter(isResolved).map((e) => e.id)).toEqual([
      'fixed',
      'wontfix',
    ]);
  });

  it('counts the viewer’s vote as theirs, as a GitHub review is', () => {
    expect(ids('mine')).toEqual(['vote']);
  });
});

describe('matchingComments', () => {
  it('names the reply deep in a thread that matches', () => {
    const replies = Array.from({ length: 125 }, (_, i) =>
      comment(`r${i + 1}`, 'bea', `reply ${i + 1}`, T(1))
    );
    replies[119] = comment('r120', 'bea', 'the needle', T(1));
    const [entry] = buildActivity(
      conversation({
        threads: [
          thread('long', [comment('root', 'alex', 'root', T(1)), ...replies]),
        ],
      })
    );
    expect([...matchingComments(entry!, 'needle')]).toEqual(['r120']);
    expect(matchingComments(entry!, '  ').size).toBe(0);
  });
});

describe('splitNew', () => {
  const entries = buildActivity(
    conversation({
      comments: [
        comment('a', 'bea', 'first', T(1)),
        comment('b', 'bea', 'arrived later', T(2)),
      ],
    })
  );

  it('holds back what arrived after the reader started reading', () => {
    const { shown, held } = splitNew(entries, new Set(['a']), 'me');
    expect(shown.map((e) => e.id)).toEqual(['a']);
    expect(held.map((e) => e.id)).toEqual(['b']);
  });

  it('shows what the reader wrote themselves at once', () => {
    const { shown, held } = splitNew(entries, new Set(['a']), 'BEA');
    expect(shown.map((e) => e.id)).toEqual(['a', 'b']);
    expect(held).toEqual([]);
  });
});
