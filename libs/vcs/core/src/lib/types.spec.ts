import { describe, expect, it } from 'vitest';
import { asksForReview, holdingVerdict, type ReviewDecision } from './types.js';

const by = (name: string, decision: ReviewDecision) => ({ name, decision });

describe('holdingVerdict', () => {
  it('names the most severe verdict holding it back, with everyone who gave it', () => {
    expect(
      holdingVerdict([
        by('bea', 'changes-requested'),
        by('cy', 'waiting-for-author'),
        by('di', 'waiting-for-author'),
        by('ed', 'approved'),
      ])
    ).toEqual({
      decision: 'waiting-for-author',
      by: [by('cy', 'waiting-for-author'), by('di', 'waiting-for-author')],
    });
    expect(
      holdingVerdict([by('bea', 'waiting-for-author'), by('cy', 'rejected')])
        ?.decision
    ).toBe('rejected');
  });

  it('is null where nothing holds it back', () => {
    expect(
      holdingVerdict([by('bea', 'approved'), by('cy', 'no-response')])
    ).toBeNull();
    expect(holdingVerdict([by('bea', 'declined')])).toBeNull();
  });
});

describe('asksForReview', () => {
  const reviewer = (decision: ReviewDecision, requested?: boolean) => ({
    identifier: 'bob',
    displayName: 'Bob',
    decision,
    requested,
  });

  it('takes the request where the list states it', () => {
    // GitHub: asked, asked again after a verdict, or only commented.
    expect(asksForReview(reviewer('no-response', true))).toBe(true);
    expect(asksForReview(reviewer('approved', true))).toBe(true);
    expect(asksForReview(reviewer('no-response', false))).toBe(false);
    expect(asksForReview(reviewer('declined', true))).toBe(false);
  });

  it('asks a listed reviewer with no vote where the list does not say', () => {
    // Azure DevOps keeps no request apart from its list.
    expect(asksForReview(reviewer('no-response'))).toBe(true);
    expect(asksForReview(reviewer('approved'))).toBe(false);
  });
});
