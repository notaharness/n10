import { describe, expect, it } from 'vitest';
import {
  commitMru,
  EMPTY_MRU,
  noteTabs,
  stepMru,
  type TabMru,
} from './tab-mru.js';

const STRIP = ['a', 'b', 'c', 'd'];

/** Visit tabs in this order, as clicks would. */
function visited(...ids: string[]): TabMru {
  return ids.reduce((mru, id) => noteTabs(mru, STRIP, id), EMPTY_MRU);
}

/** Hold the modifier, press `presses` times, and let go. */
function walk(
  mru: TabMru,
  activeId: string,
  presses: (1 | -1)[]
): { mru: TabMru; landed: string | null } {
  let state = mru;
  let active: string | null = activeId;
  for (const delta of presses) {
    const step = stepMru(state, STRIP, active, delta);
    state = noteTabs(step.mru, STRIP, step.target ?? active);
    active = step.target ?? active;
  }
  return { mru: commitMru(state), landed: active };
}

describe('tab MRU', () => {
  it('orders tabs by last activation, unseen tabs last in strip order', () => {
    expect(visited('c', 'a').order).toEqual(['a', 'c', 'b', 'd']);
  });

  it('a quick tap toggles between the two most recent tabs', () => {
    const start = visited('b', 'd');
    const first = walk(start, 'd', [1]);
    expect(first.landed).toBe('b');
    const second = walk(first.mru, 'b', [1]);
    expect(second.landed).toBe('d');
  });

  it('presses while held step deeper; releasing makes the landing most recent', () => {
    const start = visited('a', 'b', 'c', 'd');
    const { mru, landed } = walk(start, 'd', [1, 1]);
    expect(landed).toBe('b');
    expect(mru.order).toEqual(['b', 'd', 'c', 'a']);
    expect(mru.cycle).toBeNull();
  });

  it('the order holds still while a walk moves the active tab', () => {
    const start = visited('a', 'b', 'c', 'd');
    const step = stepMru(start, STRIP, 'd', 1);
    const during = noteTabs(step.mru, STRIP, step.target);
    expect(during.order).toEqual(['d', 'c', 'b', 'a']);
  });

  it('steps backwards and wraps', () => {
    const start = visited('a', 'b', 'c', 'd');
    expect(walk(start, 'd', [-1]).landed).toBe('a');
    expect(walk(start, 'd', [1, 1, 1, 1]).landed).toBe('d');
  });

  it('starts from the active tab even if the order lags behind it', () => {
    const start = visited('a', 'b');
    expect(stepMru(start, STRIP, 'c', 1).target).toBe('b');
  });

  it('drops a tab closed mid-walk and carries on', () => {
    const start = visited('a', 'b', 'c', 'd');
    const first = stepMru(start, STRIP, 'd', 1);
    expect(first.target).toBe('c');
    const remaining = ['a', 'b', 'c'];
    const next = stepMru(first.mru, remaining, 'c', 1);
    expect(next.target).toBe('b');
  });

  it('closing the tab the walk is on carries on from its place', () => {
    // Snapshot d c b a; the walk is on c when c closes.
    const start = visited('a', 'b', 'c', 'd');
    const onC = stepMru(start, STRIP, 'd', 1);
    expect(onC.target).toBe('c');
    const remaining = ['a', 'b', 'd'];
    // Onwards goes to c's next neighbour, not back to the front…
    expect(stepMru(onC.mru, remaining, 'd', 1).target).toBe('b');
    // …and backwards to the one before it.
    expect(stepMru(onC.mru, remaining, 'd', -1).target).toBe('d');
    // The walk then continues through what is left.
    const onB = stepMru(onC.mru, remaining, 'd', 1);
    expect(stepMru(onB.mru, remaining, 'b', 1).target).toBe('a');
    expect(commitMru(onB.mru).order[0]).toBe('b');
  });

  it('has nowhere to go with fewer than two tabs', () => {
    expect(stepMru(EMPTY_MRU, ['a'], 'a', 1).target).toBeNull();
    expect(commitMru(EMPTY_MRU)).toBe(EMPTY_MRU);
  });

  it('forgets closed tabs', () => {
    const mru = noteTabs(visited('a', 'b', 'c'), ['a', 'c'], 'c');
    expect(mru.order).toEqual(['c', 'a']);
  });
});
