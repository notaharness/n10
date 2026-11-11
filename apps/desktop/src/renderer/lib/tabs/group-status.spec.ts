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
    expect(rosterSummary(['idle', 'idle'])).toBe('No attention needed');
  });
  it('says Ended or Not yet opened for an idle tab, never Done', () => {
    expect(rowStatus('idle', { exited: true, unseen: false })).toBe('Ended');
    expect(rowStatus('idle', { exited: false, unseen: true })).toBe(
      'Not yet opened'
    );
    expect(rowStatus('new-output', { exited: true, unseen: true })).toBe(
      'New output'
    );
  });
});
