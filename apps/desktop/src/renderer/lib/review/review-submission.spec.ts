import { describe, expect, it } from 'vitest';
import type { ReviewDraft } from '../../../host/contract.js';
import {
  approvalBlock,
  defaultChoice,
  failureOf,
  fileableDrafts,
  missingWords,
  outcomeOf,
  submitLabel,
  verdictOptions,
} from './review-submission.js';

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);

type Publication = ReviewDraft['publication'];
const unpublished: Publication = { state: 'unpublished' };
const published: Publication = {
  state: 'published',
  attempt: 'x',
  remoteId: 'r',
  at: 2,
};
const unknown: Publication = { state: 'unknown', attempt: 'x', since: 1 };

function draft(
  id: string,
  target: ReviewDraft['target'],
  publication: Publication = unpublished,
  body = 'text'
): ReviewDraft {
  return { id, target, body, createdAt: 1, updatedAt: 1, publication };
}

const inline = (id: string, head: string | null, p?: Publication) =>
  draft(
    id,
    {
      kind: 'inline',
      key: id,
      anchor: {
        path: 'a.ts',
        previousPath: null,
        range: null,
        head,
        lines: [],
      },
    },
    p
  );

describe('the verdicts a provider offers', () => {
  it('keeps the provider’s order and leaves out resetting a vote', () => {
    expect(
      verdictOptions(['COMMENT', 'APPROVE', 'RESET_VOTE', 'REJECT']).map(
        (o) => o.label
      )
    ).toEqual(['Comment', 'Approve', 'Reject']);
  });

  it('labels the submit button with the verdict it files', () => {
    expect(submitLabel('COMMENT')).toBe('Submit comment');
    expect(submitLabel('APPROVE')).toBe('Approve');
    expect(submitLabel('REQUEST_CHANGES')).toBe('Request changes');
    expect(submitLabel('WAIT_FOR_AUTHOR')).toBe('Wait for author');
  });
});

describe('approving', () => {
  it('needs the changes read at the provider’s current head', () => {
    expect(approvalBlock(HEAD, HEAD)).toBeNull();
    expect(approvalBlock(null, HEAD)).toBe('The changes are still loading.');
    expect(approvalBlock(HEAD, undefined)).toBe(
      'Refresh the pull request to approve.'
    );
    expect(approvalBlock(HEAD, NEXT, true)).toBe(
      'Choose changes up to the latest commit to approve.'
    );
    expect(approvalBlock(HEAD, NEXT)).toBe(
      'New commits were pushed since you opened this. Load them to approve.'
    );
  });
});

describe('what a review must say', () => {
  it('asks a comment or a request for changes for words, not an approval', () => {
    expect(missingWords('COMMENT', false)).toMatch(/^Write a summary/);
    expect(missingWords('REQUEST_CHANGES', false)).toMatch(/^Say what needs/);
    expect(missingWords('APPROVE', false)).toBeNull();
    expect(missingWords('REQUEST_CHANGES', true)).toBeNull();
  });
});

describe('the drafts a review files', () => {
  it('lists comments on code and replies, not conversation comments or the summary', () => {
    const drafts = [
      inline('i', HEAD),
      draft('r', { kind: 'reply', threadId: 't' }),
      draft('g', { kind: 'general' }),
      draft('s', { kind: 'summary' }),
    ];
    expect(fileableDrafts(drafts, HEAD).map((f) => f.draft.id)).toEqual([
      'i',
      'r',
    ]);
  });

  it('leaves out what is posted or empty', () => {
    const drafts = [
      inline('p', HEAD, published),
      draft('e', { kind: 'reply', threadId: 't' }, unpublished, '  '),
    ];
    expect(fileableDrafts(drafts, HEAD)).toEqual([]);
  });

  it('chooses everything that can go, but not a comment written on another commit', () => {
    const fileable = fileableDrafts(
      [
        inline('here', HEAD),
        inline('there', NEXT),
        inline('lost', HEAD, unknown),
      ],
      HEAD
    );
    expect(fileable.map((f) => [f.draft.id, f.locked, f.writtenOn])).toEqual([
      ['here', false, null],
      ['there', false, NEXT],
      ['lost', true, null],
    ]);
    expect(defaultChoice(fileable)).toEqual(['here', 'lost']);
  });
});

describe('what came of a submit', () => {
  const ref = { owner: 'o', repo: 'r', number: 1 } as never;

  it('counts the chosen comments filed, not the summary', () => {
    const drafts = [
      inline('i', HEAD, published),
      inline('left', HEAD),
      draft('s', { kind: 'summary' }, published),
    ];
    expect(
      outcomeOf({ ref, viewer: 'bea', drafts, resumed: null }, ['i', 's'])
    ).toEqual({ kind: 'confirmed', filed: 1 });
    expect(
      outcomeOf(
        { ref, viewer: 'bea', drafts, resumed: { state: 'APPROVED' } },
        ['i']
      )
    ).toEqual({ kind: 'resumed', state: 'APPROVED', filed: 1 });
  });

  it('is unknown while a chosen draft may be posted, refused otherwise', () => {
    const drafts = [inline('lost', HEAD, unknown), inline('i', HEAD)];
    expect(failureOf('timeout', drafts, ['lost'])).toEqual({
      kind: 'unknown',
      reason: 'timeout',
    });
    expect(failureOf('stale head', drafts, ['i'])).toEqual({
      kind: 'refused',
      reason: 'stale head',
    });
  });
});
