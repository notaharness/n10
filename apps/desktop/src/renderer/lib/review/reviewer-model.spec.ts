import { describe, expect, it } from 'vitest';
import type {
  ReviewerStanding,
  ReviewRequirements,
} from '../../../host/contract.js';
import { reviewerRows, standingLabel } from './reviewer-model.js';

function standing(over: Partial<ReviewerStanding>): ReviewerStanding {
  return {
    kind: 'user',
    identifier: 'someone',
    displayName: 'Someone',
    decision: 'no-response',
    requested: true,
    requirement: 'unknown',
    reason: null,
    rules: [],
    ...over,
  };
}

function requirements(
  items: ReviewerStanding[],
  complete = true
): ReviewRequirements {
  return {
    reviewers: {
      state: 'read',
      value: complete
        ? { items, total: items.length, complete: true }
        : { items, total: 12, complete: false },
    },
  };
}

const RULE = {
  name: 'Ruleset',
  asks: '1 approval required',
  paths: ['src/**'],
  applies: null,
};

describe('standingLabel', () => {
  const label = (s: Partial<ReviewerStanding>, grouped = false) =>
    standingLabel(standing(s), grouped);

  it('says why they were asked, where the provider says', () => {
    expect(label({ requirement: 'optional', reason: 'policy' })).toBe(
      'By policy'
    );
    expect(label({ reason: 'code-owner' })).toBe('Code owner');
    // A rule names them, though GitHub does not say they are required.
    expect(label({ rules: [RULE] })).toBe('Named in a rule');
    // Asked, and nothing more is known: nothing to add.
    expect(label({})).toBeNull();
    expect(label({ requirement: 'optional' })).toBeNull();
  });

  it('says required in one list, and leaves it to the heading grouped', () => {
    expect(label({ requirement: 'required', reason: 'policy' })).toBe(
      'Required, by policy'
    );
    expect(label({ requirement: 'required' })).toBe('Required');
    expect(label({ requirement: 'required', reason: 'code-owner' })).toBe(
      'Required code owner'
    );
    expect(label({ requirement: 'required', reason: 'policy' }, true)).toBe(
      'By policy'
    );
    expect(label({ requirement: 'required' }, true)).toBeNull();
  });
});

describe('reviewerRows', () => {
  const listed = [
    { identifier: 'bob', displayName: 'Bob', decision: 'approved' as const },
  ];
  /** Each group's kind and its rows' standings. */
  const titles = (r: ReturnType<typeof reviewerRows>) =>
    r.groups.map((g) => [
      g.kind,
      g.rows.map((row) => [row.identifier, row.standing]),
    ]);

  it('shows the list row, without standings, until the detail answers', () => {
    expect(reviewerRows(listed, null)).toEqual({
      groups: [
        {
          kind: 'all',
          title: null,
          rows: [{ ...listed[0], standing: null, rules: [] }],
        },
      ],
      notes: [],
    });
    expect(
      reviewerRows(listed, {
        reviewers: { state: 'failed', kind: 'network', reason: 'offline' },
      }).notes
    ).toEqual(["Couldn't load which reviewers are required."]);
  });

  it('puts the required first and the optional under a heading', () => {
    const got = reviewerRows(
      listed,
      requirements([
        standing({ identifier: 'harrie', requirement: 'optional' }),
        standing({
          identifier: 'a70xx',
          requirement: 'required',
          reason: 'policy',
        }),
        standing({
          identifier: 'juul',
          requirement: 'optional',
          reason: 'policy',
          rules: [RULE],
        }),
        standing({ identifier: 'des', requirement: 'required' }),
      ])
    );
    expect(titles(got)).toEqual([
      [
        'required',
        [
          ['a70xx', 'By policy'],
          ['des', null],
        ],
      ],
      [
        'optional',
        [
          ['harrie', null],
          ['juul', 'By policy'],
        ],
      ],
    ]);
    expect(got.groups.map((g) => g.title)).toEqual([null, 'Optional']);
    expect(got.groups[1]?.rows[1]?.rules).toEqual([RULE]);
    expect(got.notes).toEqual([]);
  });

  it('keeps one list where the provider marks no one, or only one kind', () => {
    // GitHub states no requirement: nothing is said about it.
    const github = reviewerRows(
      listed,
      requirements([
        standing({ identifier: 'org/core', reason: 'code-owner' }),
        standing({ identifier: 'bea' }),
      ])
    );
    expect(titles(github)).toEqual([
      [
        'all',
        [
          ['org/core', 'Code owner'],
          ['bea', null],
        ],
      ],
    ]);
    expect(github.notes).toEqual([]);
    const required = reviewerRows(
      listed,
      requirements([standing({ identifier: 'des', requirement: 'required' })])
    );
    expect(titles(required)).toEqual([['all', [['des', 'Required']]]]);
    // A requirement left unstated is read as neither: no heading.
    const mixed = reviewerRows(
      listed,
      requirements([
        standing({ identifier: 'bea' }),
        standing({ identifier: 'cam', requirement: 'optional' }),
        standing({ identifier: 'des', requirement: 'required' }),
      ])
    );
    expect(titles(mixed)).toEqual([
      [
        'all',
        [
          ['des', 'Required'],
          ['bea', null],
          ['cam', null],
        ],
      ],
    ]);
    const optional = reviewerRows(
      listed,
      requirements([standing({ identifier: 'bea', requirement: 'optional' })])
    );
    expect(titles(optional)).toEqual([['all', [['bea', null]]]]);
  });

  it('counts a partial list', () => {
    const azure = requirements([standing({ requirement: 'required' })], false);
    expect(reviewerRows(listed, azure).notes).toEqual([
      '1 of 12 reviewers shown.',
    ]);
  });
});
