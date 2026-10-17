import { describe, expect, it } from 'vitest';
import { offered, typedInFull } from './mention-search.js';

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

describe('typedInFull', () => {
  const people = [
    { token: '@alex', handle: 'alex', displayName: 'Alex Author' },
    { token: '@alexa', handle: 'alexa', displayName: 'Alexa' },
  ];

  it('closes the list for a login typed out in full, whatever its case', () => {
    expect(typedInFull('alex', people)).toBe(true);
    expect(typedInFull('ALEX', people)).toBe(true);
  });

  it('keeps it for part of one', () => {
    expect(typedInFull('ale', people)).toBe(false);
    expect(typedInFull('alex', [])).toBe(false);
  });
});
