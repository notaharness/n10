import { describe, expect, it } from 'vitest';
import {
  groupSummary,
  rosterSummary,
  rowStatus,
  tabCount,
} from './group-status.js';

describe('group status text', () => {
  it('summarises every state present, worst first', () => {
    expect(
      groupSummary([
        'idle',
        'new-output',
        'working',
        'new-output',
        'working',
        'working',
        'working',
        'working',
        'blocked',
      ])
    ).toBe('9 tabs. 1 blocked, 2 new output, 5 working, 1 idle.');
    expect(tabCount(1)).toBe('1 tab');
    expect(rosterSummary(['working', 'idle'])).toBe('1 working · 1 idle');
    expect(rosterSummary(['idle', 'idle'])).toBe('');
  });
  it('says nothing for an idle tab but an ended or unopened one, never Done', () => {
    const none = { exited: false, unseen: false };
    expect(rowStatus('idle', none)).toBe('');
    expect(rowStatus('new-output', none)).toBe('New output');
    expect(rowStatus('working', none)).toBe('Working');
    // Not idle, though no state says so: an agent that ended, a tab
    // nobody has looked at.
    expect(rowStatus('idle', { exited: true, unseen: true })).toBe('Ended');
    expect(rowStatus('idle', { exited: false, unseen: true })).toBe(
      'Not yet opened'
    );
    expect(rowStatus('working', { exited: false, unseen: true })).toBe(
      'Working'
    );
  });
});
