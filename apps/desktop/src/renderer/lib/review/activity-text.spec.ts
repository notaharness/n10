import { describe, expect, it } from 'vitest';
import type { ConversationComment } from '../../../host/contract.js';
import { commentPreview } from './activity-text.js';

const SUPPORTED = { state: 'supported' } as const;

function comment(over: Partial<ConversationComment>): ConversationComment {
  return {
    id: 'c',
    author: null,
    source: '',
    body: '',
    kind: 'text',
    deleted: false,
    createdAt: null,
    editedAt: null,
    minimized: null,
    pending: false,
    replyTo: null,
    reviewId: null,
    url: null,
    capabilities: { edit: SUPPORTED, delete: SUPPORTED },
    ...over,
  };
}

describe('commentPreview', () => {
  it('is the first line of prose, without a Conventional Comments label', () => {
    expect(
      commentPreview(
        comment({ body: 'nitpick: Name this `stopTimer`.\n\nMore' })
      )
    ).toBe('Name this `stopTimer`.');
  });

  it('keeps hidden text hidden, and says why', () => {
    expect(
      commentPreview(
        comment({ body: 'spam link', minimized: { reason: 'off_topic' } })
      )
    ).toBe('Hidden as off topic.');
    expect(
      commentPreview(comment({ body: 'spam', minimized: { reason: null } }))
    ).toBe('Hidden.');
  });

  it('says a deleted comment was deleted', () => {
    expect(commentPreview(comment({ deleted: true }))).toBe(
      'This comment was deleted.'
    );
  });
});
