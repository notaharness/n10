import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followScheduler } from './follow-scheduler.js';

const ORDER = ['a', 'b', 'c', 'd'];

function setup(shown: string | null = null) {
  const state = { shown, switches: [] as string[] };
  const s = followScheduler({
    rank: (id) => ORDER.indexOf(id),
    show: (id) => {
      state.shown = id;
      state.switches.push(id);
    },
  });
  return { s, state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a follow pane’s switching', () => {
  it('switches 250 ms after new output, not before', () => {
    const { s, state } = setup('a');
    s.note('c');
    vi.advanceTimersByTime(249);
    expect(state.switches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(state.switches).toEqual(['c']);
  });

  it('takes events within 250 ms as one, ties going to presented order', () => {
    const { s, state } = setup('a');
    s.note('d');
    vi.advanceTimersByTime(100);
    s.note('b');
    vi.advanceTimersByTime(200);
    expect(state.switches).toEqual(['b']);
  });

  it('switches at most once every 2 s, the latest waiting event winning', () => {
    const { s, state } = setup('a');
    s.note('b');
    vi.advanceTimersByTime(250);
    expect(state.switches).toEqual(['b']);
    vi.advanceTimersByTime(250);
    s.note('c');
    vi.advanceTimersByTime(600);
    s.note('d');
    vi.advanceTimersByTime(1149);
    // 2 s after the first switch.
    expect(state.switches).toEqual(['b']);
    vi.advanceTimersByTime(1);
    expect(state.switches).toEqual(['b', 'd']);
    vi.advanceTimersByTime(5000);
    expect(state.switches).toEqual(['b', 'd']);
  });

  it('drops an event whose output is no longer new', () => {
    const { s, state } = setup('a');
    s.note('c');
    s.forget('c');
    vi.advanceTimersByTime(1000);
    expect(state.switches).toEqual([]);
  });

  it('falls back on an older event when the latest is forgotten', () => {
    const { s, state } = setup('a');
    s.note('b');
    vi.advanceTimersByTime(250);
    s.note('c');
    vi.advanceTimersByTime(500);
    s.note('d');
    s.forget('d');
    vi.advanceTimersByTime(2000);
    expect(state.switches).toEqual(['b', 'c']);
  });

  it('shows the latest even when the pane is on it, and the older event stays beaten', () => {
    // An item tab on its diff: showing it brings up its agent's output.
    const { s, state } = setup('c');
    s.setPaused(true);
    s.note('b');
    vi.advanceTimersByTime(300);
    s.note('c');
    s.setPaused(false);
    vi.advanceTimersByTime(500);
    expect(state.switches).toEqual(['c']);
    vi.advanceTimersByTime(5000);
    expect(state.switches).toEqual(['c']);
  });

  it('counts showing the tab it is on toward the 2 s limit', () => {
    const { s, state } = setup('a');
    s.note('a');
    vi.advanceTimersByTime(250);
    s.note('b');
    vi.advanceTimersByTime(1999);
    expect(state.switches).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(state.switches).toEqual(['a', 'b']);
  });

  it('waits while paused, and shows the latest 500 ms after the pause lifts', () => {
    const { s, state } = setup('a');
    s.setPaused(true);
    s.note('b');
    vi.advanceTimersByTime(300);
    s.note('c');
    vi.advanceTimersByTime(5000);
    expect(state.switches).toEqual([]);
    s.setPaused(false);
    vi.advanceTimersByTime(499);
    expect(state.switches).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(state.switches).toEqual(['c']);
  });

  it('stays paused when the user comes back within 500 ms', () => {
    const { s, state } = setup('a');
    s.setPaused(true);
    s.note('b');
    s.setPaused(false);
    vi.advanceTimersByTime(300);
    s.setPaused(true);
    vi.advanceTimersByTime(5000);
    expect(state.switches).toEqual([]);
  });

  it('cancels a pending switch when paused', () => {
    const { s, state } = setup('a');
    s.note('b');
    vi.advanceTimersByTime(100);
    s.setPaused(true);
    vi.advanceTimersByTime(5000);
    expect(state.switches).toEqual([]);
  });

  it('switches nothing once disposed', () => {
    const { s, state } = setup('a');
    s.note('b');
    s.dispose();
    vi.advanceTimersByTime(5000);
    expect(state.switches).toEqual([]);
  });
});

describe('what counts as new output', () => {
  it('takes the first answer as a baseline: output already waiting is no news', () => {
    const { s, state } = setup('a');
    s.observe(['b'], 'repo');
    vi.advanceTimersByTime(1000);
    expect(state.switches).toEqual([]);
  });

  it('counts a change to new output', () => {
    const { s, state } = setup('a');
    s.observe([], 'repo');
    s.observe(['c'], 'repo');
    vi.advanceTimersByTime(250);
    expect(state.switches).toEqual(['c']);
  });

  it('forgets a tab whose output was seen before its turn', () => {
    const { s, state } = setup('a');
    s.observe([], 'repo');
    s.observe(['c'], 'repo');
    s.observe([], 'repo');
    vi.advanceTimersByTime(1000);
    expect(state.switches).toEqual([]);
  });

  it('reads nothing while there is no answer, then compares with the last one', () => {
    const { s, state } = setup('a');
    s.observe([], 'repo');
    s.observe(['b', 'c'], null);
    vi.advanceTimersByTime(1000);
    expect(state.switches).toEqual([]);
    // Output that came while there was no answer is news once it is back.
    s.observe(['c'], 'repo');
    vi.advanceTimersByTime(250);
    expect(state.switches).toEqual(['c']);
  });

  it('takes another repository’s first answer as a new baseline, dropping what waited', () => {
    const { s, state } = setup('a');
    s.observe([], 'one');
    s.observe(['b'], 'one');
    s.observe(['b', 'c'], 'two');
    vi.advanceTimersByTime(1000);
    expect(state.switches).toEqual([]);
  });
});
