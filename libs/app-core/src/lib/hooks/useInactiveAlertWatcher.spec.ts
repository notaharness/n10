import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionBackend } from '@n10/terminal';
import {
  attach,
  noteSeen,
  ACTIVITY_IDLE_MS,
  __resetActivityForTests as resetActivity,
} from '@n10/core';
import { pollIdleTransitions } from './useInactiveAlertWatcher.js';

class MockPty {
  private dataCb: ((s: string) => void) | null = null;
  private exitCb: ((c: number) => void) | null = null;
  onData = vi.fn((cb: (s: string) => void) => {
    this.dataCb = cb;
  });
  offData = vi.fn(() => {
    this.dataCb = null;
  });
  onExit = vi.fn((cb: (c: number) => void) => {
    this.exitCb = cb;
  });
  offExit = vi.fn(() => {
    this.exitCb = null;
  });
  emit(data: string) {
    this.dataCb?.(data);
  }
  exit(code = 0) {
    this.exitCb?.(code);
  }
  asPty(): SessionBackend {
    return this as unknown as SessionBackend;
  }
}

const bravo = { name: 'bravo' };

/** Start `bravo`, let it print, and return the poll that saw it active. */
function startActive(): { pty: MockPty; prev: Map<string, boolean> } {
  const pty = new MockPty();
  attach(bravo.name, pty.asPty());
  vi.advanceTimersByTime(100);
  pty.emit('n10-session-active');
  const { active } = pollIdleTransitions([bravo], new Map(), bravo.name);
  expect(active.get(bravo.name)).toBe(true);
  return { pty, prev: active };
}

function pollAfterIdle(prev: Map<string, boolean>, viewed: string | null) {
  vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1);
  return pollIdleTransitions([bravo], prev, viewed);
}

describe('pollIdleTransitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetActivity();
  });

  afterEach(() => {
    resetActivity();
    vi.useRealTimers();
  });

  it('reports a session that goes idle with output the user has not seen', () => {
    const { prev } = startActive();

    const { active, idle } = pollAfterIdle(prev, 'alpha');

    expect(active.get(bravo.name)).toBe(false);
    expect(idle).toEqual([bravo]);
  });

  it('skips a session the user saw, then left before it read as idle', () => {
    const { prev } = startActive();
    // The sidebar acknowledges the selected row when the user moves off it.
    vi.advanceTimersByTime(100);
    noteSeen(bravo.name);

    expect(pollAfterIdle(prev, 'alpha').idle).toEqual([]);
  });

  it('skips the session being viewed', () => {
    const { prev } = startActive();

    expect(pollAfterIdle(prev, bravo.name).idle).toEqual([]);
  });

  it('skips an agent that exited', () => {
    const { pty, prev } = startActive();
    pty.exit(0);

    expect(pollAfterIdle(prev, 'alpha').idle).toEqual([]);
  });
});
