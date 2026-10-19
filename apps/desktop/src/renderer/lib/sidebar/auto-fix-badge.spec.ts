import { describe, expect, it } from 'vitest';
import type { AutoFixStatus } from '../../../host/contract.js';
import { autoFixBadge } from './auto-fix-badge.js';

const MIN = 60_000;

function status(over: Partial<AutoFixStatus> = {}): AutoFixStatus {
  return {
    prId: 7,
    sourceBranch: 'feat',
    phase: 'watching',
    held: null,
    lastPolledAt: null,
    pendingSince: null,
    lastDeliveredAt: null,
    deliveries: 0,
    lastError: null,
    ...over,
  };
}

describe('autoFixBadge', () => {
  it('says it is watching when there is nothing to report', () => {
    expect(autoFixBadge(status(), 0)).toEqual({
      label: 'Auto-fix',
      title: 'Watching CI, review threads and conflicts',
      tone: 'info',
    });
  });

  it('says an update is waiting, and for how long', () => {
    const badge = autoFixBadge(
      status({ phase: 'pending', pendingSince: 0 }),
      7 * MIN
    );
    expect(badge.label).toBe('update pending');
    expect(badge.title).toContain('waiting since 7 min ago; sent once quiet');
  });

  it('says why a due update is being held', () => {
    const badge = autoFixBadge(
      status({ phase: 'pending', pendingSince: 0, held: 'agent-busy' }),
      MIN
    );
    expect(badge.title).toContain('held until the agent has been quiet');
  });

  it('counts deliveries and flags a failed poll', () => {
    const badge = autoFixBadge(
      status({
        deliveries: 2,
        lastDeliveredAt: 60 * MIN,
        lastError: 'gh: rate limited',
      }),
      150 * MIN
    );
    expect(badge.title).toContain('2 updates sent, last 1 h ago');
    expect(badge.title).toContain('Last check failed: gh: rate limited');
    expect(badge.tone).toBe('warning');
  });
});
