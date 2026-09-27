import { describe, expect, it } from 'vitest';
import {
  combineCoverage,
  coverageOf,
  isConversationComplete,
  type PullRequestConversation,
} from './pr-conversation.js';

const DONE = { loaded: 3, total: 3, complete: true };

function conversation(
  coverage: Partial<PullRequestConversation['coverage']> = {}
): PullRequestConversation {
  return {
    ref: {
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
      number: 1,
    },
    threads: [],
    comments: [],
    reviews: [],
    events: [],
    coverage: {
      threads: DONE,
      replies: DONE,
      comments: DONE,
      reviews: DONE,
      events: DONE,
      ...coverage,
    },
  };
}

describe('coverageOf', () => {
  it('is complete only when paging ran out and nothing counted is missing', () => {
    expect(coverageOf(100, 100, true).complete).toBe(true);
    expect(coverageOf(100, null, true).complete).toBe(true);
    expect(coverageOf(100, 130, true).complete).toBe(false);
    expect(coverageOf(100, 100, false).complete).toBe(false);
  });
});

describe('combineCoverage', () => {
  it('adds counts, and loses the total when any part has none', () => {
    expect(combineCoverage([DONE, DONE])).toEqual({
      loaded: 6,
      total: 6,
      complete: true,
    });
    expect(
      combineCoverage([DONE, { loaded: 1, total: null, complete: true }])
    ).toEqual({ loaded: 4, total: null, complete: true });
  });

  it('is incomplete when any part is', () => {
    const part = { loaded: 100, total: 126, complete: false };
    expect(combineCoverage([DONE, part]).complete).toBe(false);
  });

  it('is complete with nothing to cover', () => {
    expect(combineCoverage([])).toEqual({
      loaded: 0,
      total: 0,
      complete: true,
    });
  });
});

describe('isConversationComplete', () => {
  it('needs every collection, replies included', () => {
    expect(isConversationComplete(conversation())).toBe(true);
    expect(
      isConversationComplete(
        conversation({ replies: { loaded: 100, total: 126, complete: false } })
      )
    ).toBe(false);
  });
});
