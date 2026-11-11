import { describe, expect, it } from 'vitest';
import type { TabFace } from './use-strip-groups.js';
import { rosterSecondary } from './roster-text.js';

describe('rosterSecondary', () => {
  it('has no dangling separator when an orchestrator has no branch', () => {
    const face = {
      tab: {
        kind: 'terminal',
        repo: '/fixture/n10-one',
        cwd: '/fixture/n10-one',
      },
      branch: undefined,
    } as TabFace;
    expect(rosterSecondary(face)).toBe('n10-one');
  });
});
