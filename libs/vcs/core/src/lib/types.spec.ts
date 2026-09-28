import { describe, expect, it } from 'vitest';
import { holdingVerdict, type ReviewDecision } from './types.js';

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
