import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionBackend } from '@n10/terminal';
import {
  attach,
  showTerminal,
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

/** Start `bravo` and return the poll that saw it active. With `shown`,
 * its terminal is on screen while it prints; release it to leave. */
function startActive(opts: { shown?: boolean } = {}): {
  pty: MockPty;
  prev: Map<string, boolean>;
  release: () => void;
} {
  const pty = new MockPty();
  attach(bravo.name, pty.asPty());
  const release = opts.shown ? showTerminal(bravo.name) : () => undefined;
  vi.advanceTimersByTime(100);
  pty.emit('n10-session-active');
  const { active } = pollIdleTransitions([bravo], new Map());
  expect(active.get(bravo.name)).toBe(true);
  return { pty, prev: active, release };
}

function pollAfterIdle(prev: Map<string, boolean>) {
  vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1);
  return pollIdleTransitions([bravo], prev);
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

  it('reports a session that goes idle after printing off screen', () => {
    const { prev } = startActive();

    const { active, idle } = pollAfterIdle(prev);

    expect(active.get(bravo.name)).toBe(false);
    expect(idle).toEqual([bravo]);
  });

  it('skips a session the user watched, then left before it read as idle', () => {
    const { prev, release } = startActive({ shown: true });
    vi.advanceTimersByTime(100);
    release();

    expect(pollAfterIdle(prev).idle).toEqual([]);
  });

  it('reports a session that printed more after the user left it', () => {
    const { pty, prev, release } = startActive({ shown: true });
    vi.advanceTimersByTime(100);
    release();
    vi.advanceTimersByTime(100);
    pty.emit('more output');

    expect(pollAfterIdle(prev).idle).toEqual([bravo]);
  });

  it('skips a session whose terminal is still on screen', () => {
    const { prev } = startActive({ shown: true });

    expect(pollAfterIdle(prev).idle).toEqual([]);
  });

  it('skips an agent that exited', () => {
    const { pty, prev } = startActive();
    pty.exit(0);

    expect(pollAfterIdle(prev).idle).toEqual([]);
  });
});
