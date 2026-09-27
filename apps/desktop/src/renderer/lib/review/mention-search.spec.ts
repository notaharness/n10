import { describe, expect, it } from 'vitest';
import { offered } from './mention-search.js';

const AL = [{ token: '@alex', displayName: 'Alex Author', handle: 'alex' }];
const answer = (over: Partial<Parameters<typeof offered>[2]> = {}) => ({
  data: AL,
  error: null,
  isSuccess: true,
  isPlaceholderData: false,
  isFetching: false,
  ...over,
});

describe('who the picker offers', () => {
  it('offers the answer for the query in the box', () => {
    expect(offered('al', 'al', answer())).toEqual({
      people: AL,
      waiting: false,
      error: null,
    });
  });

  it('offers no one during the pause before a new query is asked', () => {
    expect(offered('al', 'alx', answer())).toMatchObject({
      people: [],
      waiting: true,
    });
  });

  it('offers no one from an earlier answer while the next is fetched', () => {
    expect(
      offered(
        'alx',
        'alx',
        answer({ isPlaceholderData: true, isFetching: true })
      )
    ).toMatchObject({ people: [], waiting: true });
  });
});
