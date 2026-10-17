import { describe, expect, it } from 'vitest';
import {
  isEditable,
  recordPublication,
  type Publication,
  type PublicationEvent,
  type ReviewDraft,
} from './review-draft-types.js';

function draft(
  publication: Publication = { state: 'unpublished' }
): ReviewDraft {
  return {
    id: 'general',
    target: { kind: 'general' },
    body: 'Looks right.',
    createdAt: 1,
    updatedAt: 1,
    publication,
  };
}

const run = (events: PublicationEvent[], from = draft()) =>
  events.reduce(recordPublication, from).publication;

describe('the publication ledger', () => {
  it('records a confirmed write with the id the provider gave it', () => {
    expect(
      run([
        { kind: 'begin', attempt: 'a1', at: 10 },
        { kind: 'confirmed', attempt: 'a1', remoteId: 'IC_9', at: 11 },
      ])
    ).toEqual({ state: 'published', attempt: 'a1', remoteId: 'IC_9', at: 11 });
  });

  it('treats a lost answer as unknown, and settles it only by looking', () => {
    const lost = run([
      { kind: 'begin', attempt: 'a1', at: 10 },
      { kind: 'lost', attempt: 'a1', at: 12 },
    ]);
    expect(lost).toEqual({ state: 'unknown', attempt: 'a1', since: 12 });
    const unknown = draft(lost);
    expect(isEditable(unknown)).toBe(false);
    // Not sent again while it may already be there.
    expect(() =>
      recordPublication(unknown, { kind: 'begin', attempt: 'a2', at: 13 })
    ).toThrow(/unknown/);
    expect(
      run(
        [{ kind: 'reconciled', attempt: 'a1', remoteId: 'IC_9', at: 14 }],
        unknown
      )
    ).toMatchObject({ state: 'published', remoteId: 'IC_9' });
    expect(
      run(
        [{ kind: 'reconciled', attempt: 'a1', remoteId: null, at: 14 }],
        unknown
      )
    ).toMatchObject({ state: 'failed', reason: 'It was not posted' });
  });

  it('lets a rejected draft be edited and sent again', () => {
    const failed = draft(
      run([
        { kind: 'begin', attempt: 'a1', at: 10 },
        { kind: 'rejected', attempt: 'a1', reason: 'Forbidden', at: 11 },
      ])
    );
    expect(isEditable(failed)).toBe(true);
    expect(
      run([{ kind: 'begin', attempt: 'a2', at: 12 }], failed)
    ).toMatchObject({ state: 'publishing', attempt: 'a2' });
  });

  it.each<[string, Publication, PublicationEvent]>([
    [
      'a second attempt in flight',
      { state: 'publishing', attempt: 'a1', since: 1 },
      { kind: 'begin', attempt: 'a2', at: 2 },
    ],
    [
      'an answer for another attempt',
      { state: 'publishing', attempt: 'a1', since: 1 },
      { kind: 'confirmed', attempt: 'a0', remoteId: 'x', at: 2 },
    ],
    [
      'an answer with nothing in flight',
      { state: 'unpublished' },
      { kind: 'lost', attempt: 'a1', at: 2 },
    ],
    [
      'publishing what is already published',
      { state: 'published', attempt: 'a1', remoteId: 'x', at: 1 },
      { kind: 'begin', attempt: 'a2', at: 2 },
    ],
  ])('refuses %s', (_, from, event) => {
    expect(() => recordPublication(draft(from), event)).toThrow();
  });
});
