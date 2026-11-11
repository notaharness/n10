import { describe, expect, it, vi } from 'vitest';
import { NO_ROOM, SPLIT_NEEDS_TABS, splitTab } from './pane-commands.js';
import type { PanesApi } from './use-panes.js';

const panes = () => ({ split: vi.fn() } as unknown as PanesApi);
const target = (frame: { width: number; height: number } | null) => ({
  pane: 'pane-1',
  order: ['a', 'b'],
  tabId: 'b',
  frame,
});

describe('splitTab', () => {
  it('splits when both halves keep their minimum', () => {
    const api = panes();
    expect(splitTab(api, target({ width: 500, height: 400 }), 'right')).toBe(
      null
    );
    expect(api.split).toHaveBeenCalledWith(['b'], 'pane-1', 'right', 'b');
  });

  it('says there is no room, and splits nothing, where a half would be too small', () => {
    const api = panes();
    expect(splitTab(api, target({ width: 470, height: 900 }), 'right')).toBe(
      NO_ROOM
    );
    expect(splitTab(api, target({ width: 900, height: 300 }), 'bottom')).toBe(
      NO_ROOM
    );
    expect(api.split).not.toHaveBeenCalled();
  });

  it('asks for another tab before it measures', () => {
    const api = panes();
    const lone = { ...target({ width: 10, height: 10 }), order: ['b'] };
    expect(splitTab(api, lone, 'right')).toBe(SPLIT_NEEDS_TABS);
  });
});
