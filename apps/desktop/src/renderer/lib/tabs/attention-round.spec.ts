import { describe, expect, it } from 'vitest';
import {
  nextAttention,
  type AttentionRound,
  type AttentionTab,
} from './attention-round.js';

const tabs: AttentionTab[] = [
  { id: 'active', status: 'idle' },
  { id: 'new-a', status: 'new-output' },
  { id: 'blocked-a', status: 'blocked' },
  { id: 'error-a', status: 'error' },
  { id: 'done-a', status: 'done-unseen' },
  { id: 'blocked-b', status: 'blocked' },
  { id: 'new-b', status: 'new-output' },
];

describe('attention traversal', () => {
  it('visits tier order, then presented order within each tier', () => {
    let round: AttentionRound | null = null;
    const visited: string[] = [];
    for (let i = 0; i < 6; i++) {
      const step = nextAttention(round, tabs, visited.at(-1) ?? 'active');
      round = step.round;
      visited.push(step.target!);
      expect(step.index).toBe(i + 1);
      expect(step.total).toBe(6);
    }
    expect(visited).toEqual([
      'blocked-a',
      'blocked-b',
      'error-a',
      'done-a',
      'new-a',
      'new-b',
    ]);
  });

  it('holds new activity for the next round and skips cleared tabs', () => {
    const first = nextAttention(null, tabs, 'active');
    const changed = tabs.map((tab) =>
      tab.id === 'blocked-b' ? { ...tab, status: 'idle' as const } : tab
    );
    changed.push({ id: 'later', status: 'blocked' });
    const next = nextAttention(first.round, changed, first.target);
    expect(next.target).toBe('error-a');
    let round = next.round;
    for (let i = 0; i < 3; i++)
      round = nextAttention(round, changed, 'active').round;
    const fresh = nextAttention(round, changed, 'active');
    expect(fresh.target).toBe('blocked-a');
    expect(nextAttention(fresh.round, changed, 'blocked-a').target).toBe(
      'later'
    );
  });

  it('distinguishes no pending tabs from only the current tab', () => {
    expect(
      nextAttention(null, [{ id: 'a', status: 'new-output' }], 'a').feedback
    ).toBe('current');
    expect(
      nextAttention(null, [{ id: 'a', status: 'idle' }], 'a').feedback
    ).toBe('empty');
  });
});
