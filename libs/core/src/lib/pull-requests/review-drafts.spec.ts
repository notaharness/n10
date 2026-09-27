import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PullRequestRef } from '@n10/vcs-core';
import type { ReviewDraft } from './review-draft-types.js';
import { PullRequestIdentityError } from './pr-snapshot.js';
import { draftFilePath, writeDraftFile } from './review-draft-store.js';
import {
  discardReviewDraft,
  listReviewDrafts,
  parseSaveDraftRequest,
  saveReviewDraft,
  type DraftSources,
} from './review-drafts.js';

const REPO = { provider: 'github', host: 'github.com', repository: 'acme/app' };
const REF: PullRequestRef = { ...REPO, number: 42 };
const REPLY = { kind: 'reply', threadId: 'T-1' } as const;

let dir: string;
let viewer: string | null;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-drafts-'));
  viewer = 'bea';
  clock = 1000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function src(overrides: Partial<DraftSources> = {}): DraftSources {
  return {
    repository: () => REPO,
    viewer: () => viewer,
    dir,
    now: () => clock,
    ...overrides,
  };
}

const as = (who: string | null, ref = REF) => ({ ref, viewer: who });

describe('review drafts', () => {
  it('keeps a reply exactly as typed, and restores it', () => {
    const body = '  First line\n\n```ts\nconst x = 1;\n```\n';
    saveReviewDraft({ ...as('bea'), target: REPLY, body }, src());
    clock = 2000;
    saveReviewDraft(
      { ...as('bea'), target: REPLY, body: body + 'more' },
      src()
    );

    const { drafts } = listReviewDrafts(as('bea'), src());
    expect(drafts).toEqual([
      {
        id: 'reply:T-1',
        target: REPLY,
        body: body + 'more',
        createdAt: 1000,
        updatedAt: 2000,
        publication: { state: 'unpublished' },
      },
    ]);
  });

  it('holds one draft per target', () => {
    saveReviewDraft({ ...as('bea'), target: REPLY, body: 'a' }, src());
    saveReviewDraft(
      { ...as('bea'), target: { kind: 'summary' }, body: 'b' },
      src()
    );
    saveReviewDraft(
      { ...as('bea'), target: { kind: 'reply', threadId: 'T-2' }, body: 'c' },
      src()
    );
    const ids = listReviewDrafts(as('bea'), src()).drafts.map((d) => d.id);
    expect(ids.sort()).toEqual(['reply:T-1', 'reply:T-2', 'summary']);
  });

  it('removes a draft emptied or discarded', () => {
    saveReviewDraft({ ...as('bea'), target: REPLY, body: 'a' }, src());
    saveReviewDraft(
      { ...as('bea'), target: { kind: 'general' }, body: 'b' },
      src()
    );
    saveReviewDraft({ ...as('bea'), target: REPLY, body: '' }, src());
    discardReviewDraft({ ...as('bea'), target: { kind: 'general' } }, src());
    discardReviewDraft({ ...as('bea'), target: { kind: 'general' } }, src());
    expect(listReviewDrafts(as('bea'), src()).drafts).toEqual([]);
  });

  it('never shows one account’s drafts to another (Q8)', () => {
    saveReviewDraft({ ...as('bea'), target: REPLY, body: 'private' }, src());
    viewer = 'carol';
    expect(listReviewDrafts(as('carol'), src()).drafts).toEqual([]);
    // Naming the other account is refused, not answered.
    expect(() => listReviewDrafts(as('bea'), src())).toThrow(
      PullRequestIdentityError
    );
    viewer = 'Bea';
    expect(listReviewDrafts(as('Bea'), src()).drafts).toHaveLength(1);
  });

  it('keeps repo A’s #42 apart from repo B’s (Q8)', () => {
    saveReviewDraft({ ...as('bea'), target: REPLY, body: 'for A' }, src());
    const other = { ...REPO, repository: 'acme/other' };
    const inB = src({ repository: () => other });
    expect(
      listReviewDrafts(as('bea', { ...other, number: 42 }), inB).drafts
    ).toEqual([]);
    expect(() => listReviewDrafts(as('bea'), inB)).toThrow(
      PullRequestIdentityError
    );
  });

  it('refuses a file recorded for a different repository id', () => {
    const known = { ...REF, id: 'R_1' };
    saveReviewDraft({ ...as('bea', known), target: REPLY, body: 'a' }, src());
    expect(
      listReviewDrafts(as('bea'), src()).drafts.map((d) => d.body)
    ).toEqual(['a']);
    expect(() =>
      listReviewDrafts(as('bea', { ...REF, id: 'R_2' }), src())
    ).toThrow(/another pull request/);
  });

  it('refuses to read, and so to overwrite, a file it cannot parse', () => {
    const path = draftFilePath(dir, REF, 'bea');
    writeFileSync(path, '{ not json');
    // The message names the file, so its contents can be kept by hand.
    expect(() => listReviewDrafts(as('bea'), src())).toThrow(path);
    writeFileSync(
      path,
      JSON.stringify({
        ref: REF,
        viewer: 'bea',
        drafts: [{ id: 'x', body: 3 }],
      })
    );
    expect(() => listReviewDrafts(as('bea'), src())).toThrow(/malformed/);
    expect(() =>
      saveReviewDraft({ ...as('bea'), target: REPLY, body: 'x' }, src())
    ).toThrow(/could not be read/);
  });

  it('reports a save the disk refused', () => {
    if (process.getuid?.() === 0) return;
    const locked = join(dir, 'locked');
    writeDraftFile(locked, { ref: REF, viewer: 'bea', drafts: [] });
    chmodSync(locked, 0o500);
    try {
      expect(() =>
        saveReviewDraft(
          { ...as('bea'), target: REPLY, body: 'x' },
          src({ dir: locked })
        )
      ).toThrow(/EACCES/);
    } finally {
      chmodSync(locked, 0o700);
    }
    expect(readdirSync(locked)).toHaveLength(1);
  });

  const withReply = (publication: ReviewDraft['publication']) =>
    writeDraftFile(dir, {
      ref: REF,
      viewer: 'bea',
      drafts: [
        {
          id: 'reply:T-1',
          target: REPLY,
          body: 'sent?',
          createdAt: 1,
          updatedAt: 1,
          publication,
        },
      ],
    });

  it('neither rewrites nor discards a draft that may already have been sent', () => {
    withReply({ state: 'unknown', attempt: 'a1', since: 5 });
    expect(() =>
      saveReviewDraft({ ...as('bea'), target: REPLY, body: 'x' }, src())
    ).toThrow(/may already have been posted/);
    expect(() =>
      discardReviewDraft({ ...as('bea'), target: REPLY }, src())
    ).toThrow(/may already have been posted/);
    withReply({ state: 'publishing', attempt: 'a1', since: 5 });
    expect(() =>
      discardReviewDraft({ ...as('bea'), target: REPLY }, src())
    ).toThrow(/being posted/);
  });

  it('starts a new draft over one that was published', () => {
    withReply({ state: 'published', attempt: 'a1', remoteId: 'C_1', at: 5 });
    expect(
      saveReviewDraft({ ...as('bea'), target: REPLY, body: 'again' }, src())
    ).toMatchObject({
      body: 'again',
      createdAt: 1000,
      publication: { state: 'unpublished' },
    });
  });
});

describe('parseSaveDraftRequest', () => {
  it('accepts the three targets', () => {
    for (const target of [REPLY, { kind: 'general' }, { kind: 'summary' }]) {
      expect(
        parseSaveDraftRequest({ ...as('bea'), target, body: 'x' }).target
      ).toEqual(target);
    }
  });

  it.each([
    ['no viewer', { ref: REF, target: REPLY, body: 'x' }],
    [
      'a reply with no thread',
      { ...as('bea'), target: { kind: 'reply' }, body: 'x' },
    ],
    [
      'an unknown target',
      { ...as('bea'), target: { kind: 'line' }, body: 'x' },
    ],
    ['a body that is not text', { ...as('bea'), target: REPLY, body: 3 }],
    [
      'an oversized body',
      { ...as('bea'), target: REPLY, body: 'x'.repeat(262_145) },
    ],
  ])('refuses %s', (_, value) => {
    expect(() => parseSaveDraftRequest(value)).toThrow(TypeError);
  });
});
