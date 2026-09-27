import { describe, expect, it } from 'vitest';
import type { ReviewDraft } from '../../../host/contract.js';
import { DraftEdits, editKey, type SaveRequest } from './draft-edits.js';

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};
const REPLY = { kind: 'reply', threadId: 'T-1' } as const;

/** A store with a hand-driven clock and saves answered by the test. */
function harness() {
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const saves: {
    req: SaveRequest;
    resolve: (d: ReviewDraft | null) => void;
    reject: (e: Error) => void;
  }[] = [];
  const stored: (ReviewDraft | null)[] = [];
  const edits = new DraftEdits({
    save: (req) =>
      new Promise((resolve, reject) => saves.push({ req, resolve, reject })),
    saved: (_, draft) => stored.push(draft),
    now: () => 7,
    setTimer: (fn) => {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const elapse = () => {
    const due = [...timers.values()];
    timers.clear();
    for (const fn of due) fn();
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { edits, saves, stored, elapse, settle, timers };
}

const as = (viewer: string, body: string): SaveRequest => ({
  cwd: '/repo',
  ref: REF,
  viewer,
  target: REPLY,
  body,
});
const keyOf = (viewer: string) => editKey(as(viewer, ''));

describe('DraftEdits', () => {
  it('saves after the pause, once, with the latest text', async () => {
    const h = harness();
    const key = keyOf('bea');
    h.edits.type(key, as('bea', 'Fir'));
    h.edits.type(key, as('bea', 'First'));
    expect(h.saves).toHaveLength(0);
    expect(h.timers.size).toBe(1);
    h.elapse();
    expect(h.saves.map((s) => s.req.body)).toEqual(['First']);
    h.saves[0]!.resolve(null);
    await h.settle();
    expect(h.edits.get(key)?.save).toEqual({ kind: 'saved', at: 7 });
  });

  it('keeps text whose save failed, whoever was showing it', async () => {
    const h = harness();
    const key = keyOf('bea');
    h.edits.type(key, as('bea', 'Nowhere to keep this'));
    h.elapse();
    h.saves[0]!.reject(new Error('EACCES'));
    await h.settle();
    // No component holds it; the store still does.
    expect(h.edits.get(key)).toEqual({
      text: 'Nowhere to keep this',
      save: { kind: 'failed', error: 'EACCES' },
    });
    h.edits.retry(key);
    expect(h.saves[1]!.req.body).toBe('Nowhere to keep this');
  });

  it('keeps a failure standing while the reader types on', async () => {
    const h = harness();
    const key = keyOf('bea');
    h.edits.type(key, as('bea', 'one'));
    h.elapse();
    h.saves[0]!.reject(new Error('EACCES'));
    await h.settle();
    h.edits.type(key, as('bea', 'one two'));
    expect(h.edits.get(key)?.save.kind).toBe('failed');
    h.elapse();
    h.saves[1]!.resolve(null);
    await h.settle();
    expect(h.edits.get(key)?.save.kind).toBe('saved');
  });

  it('saves everything waiting when the page goes', () => {
    const h = harness();
    h.edits.type(keyOf('bea'), as('bea', 'a'));
    h.edits.type(keyOf('carol'), as('carol', 'b'));
    h.edits.flushAll();
    expect(h.saves.map((s) => s.req.body).sort()).toEqual(['a', 'b']);
    expect(h.timers.size).toBe(0);
  });

  it('lets only the latest save speak for the text', async () => {
    const h = harness();
    const key = keyOf('bea');
    h.edits.type(key, as('bea', 'one'));
    h.elapse();
    h.edits.type(key, as('bea', 'two'));
    h.elapse();
    h.saves[1]!.resolve(null);
    h.saves[0]!.reject(new Error('late failure'));
    await h.settle();
    expect(h.edits.get(key)?.save.kind).toBe('saved');
  });

  it('shows saving while newer text waits, whatever an older save said', async () => {
    const h = harness();
    const key = keyOf('bea');
    h.edits.type(key, as('bea', 'one'));
    h.elapse();
    h.edits.type(key, as('bea', 'one two'));
    h.saves[0]!.resolve(null);
    await h.settle();
    expect(h.edits.get(key)?.save.kind).toBe('saving');
  });

  it('keeps each account’s text apart', () => {
    const h = harness();
    h.edits.type(keyOf('bea'), as('bea', 'bea’s'));
    expect(h.edits.get(keyOf('carol'))).toBeUndefined();
    expect(keyOf('Bea')).toBe(keyOf('bea'));
  });

  it('forgets discarded text, and a save still in flight does not bring it back', async () => {
    const h = harness();
    const key = keyOf('bea');
    h.edits.type(key, as('bea', 'gone'));
    h.elapse();
    h.edits.forget(key);
    h.saves[0]!.resolve(null);
    await h.settle();
    expect(h.edits.get(key)).toBeUndefined();
  });

  it('forgets text still waiting for its pause without saving it', () => {
    const h = harness();
    const key = keyOf('bea');
    h.edits.type(key, as('bea', 'gone'));
    h.edits.forget(key);
    h.elapse();
    expect(h.saves).toHaveLength(0);
  });

  it('keeps text with no identity to save against in memory only', () => {
    const h = harness();
    const key = keyOf('bea');
    h.edits.local(key, as('bea', 'local'));
    h.elapse();
    expect(h.saves).toHaveLength(0);
    expect(h.edits.get(key)).toEqual({ text: 'local', save: { kind: 'idle' } });
  });
});
