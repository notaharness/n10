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

describe('standingLabel', () => {
  it('says required or optional, and why', () => {
    const label = (s: Partial<ReviewerStanding>) => standingLabel(standing(s));
    expect(label({ requirement: 'required', reason: 'policy' })).toBe(
      'Required, by policy'
    );
    expect(label({ requirement: 'required' })).toBe('Required');
    expect(label({ requirement: 'optional', reason: 'policy' })).toBe(
      'Optional, by policy'
    );
    expect(label({ requirement: 'optional' })).toBe('Optional');
    expect(label({ reason: 'code-owner' })).toBe('Code owner');
    // A rule names them, though GitHub does not say they are required.
    const rule = {
      name: 'Branch rule',
      asks: '1 approval required',
      paths: ['src/**'],
      applies: null,
    };
    expect(label({ rules: [rule] })).toBe('Named by a rule');
    // Asked, and nothing more is known: nothing to add.
    expect(label({})).toBeNull();
  });
});

describe('reviewerRows', () => {
  const listed = [
    { identifier: 'bob', displayName: 'Bob', decision: 'approved' as const },
  ];

  it('shows the list row, without standings, until the detail answers', () => {
    expect(reviewerRows(listed, null, 'github')).toEqual({
      rows: [{ ...listed[0], standing: null, rules: [] }],
      notes: [],
    });
    expect(
      reviewerRows(
        listed,
        {
          reviewers: { state: 'failed', kind: 'network', reason: 'offline' },
        },
        'github'
      ).notes
    ).toEqual(["The reviewers' details could not be read."]);
  });

  it('names the provider that does not mark reviewers required', () => {
    const got = reviewerRows(
      listed,
      requirements([
        standing({ identifier: 'org/core', reason: 'code-owner' }),
      ]),
      'github'
    );
    expect(got.rows).toEqual([
      {
        identifier: 'org/core',
        displayName: 'Someone',
        decision: 'no-response',
        standing: 'Code owner',
        rules: [],
      },
    ]);
    expect(got.notes).toEqual(["GitHub doesn't mark reviewers required."]);
  });

  it('says nothing more where every standing is known, and counts a partial list', () => {
    const azure = requirements([standing({ requirement: 'required' })], false);
    expect(reviewerRows(listed, azure, 'azure-devops').notes).toEqual([
      '1 of 12 reviewers shown.',
    ]);
  });
});
