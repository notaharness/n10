import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  entries: new Map<
    string,
    {
      exited: boolean;
      pty: {
        connectionState?: string;
        write: ReturnType<typeof vi.fn>;
        resize: ReturnType<typeof vi.fn>;
      };
    }
  >(),
  logged: [] as string[],
}));
vi.mock('@n10/core', () => ({
  getSession: (name: string) => state.entries.get(name),
  noteInput: () => undefined,
  noteResize: () => undefined,
}));
import { resizeSession, writeSession } from './session-io.js';

function entry(exited = false) {
  const e = { exited, pty: { write: vi.fn(), resize: vi.fn() } };
  state.entries.set('agent', e);
  return e;
}

beforeEach(() => {
  state.entries.clear();
  state.logged.length = 0;
  vi.spyOn(console, 'log').mockImplementation((message: string) => {
    state.logged.push(message);
  });
});

describe('a running session', () => {
  it('takes input and resizes', () => {
    const e = entry();
    writeSession('agent', 'x');
    resizeSession('agent', 80, 24);
    expect(e.pty.write).toHaveBeenCalledWith('x');
    expect(e.pty.resize).toHaveBeenCalledWith(80, 24);
  });
});

// The pane can send both before it has heard the session ended.
describe('an ended session', () => {
  it('drops input and resizes without throwing, and logs them', () => {
    const e = entry(true);
    expect(() => writeSession('agent', 'x')).not.toThrow();
    expect(() => resizeSession('agent', 80, 24)).not.toThrow();
    expect(e.pty.write).not.toHaveBeenCalled();
    expect(e.pty.resize).not.toHaveBeenCalled();
    expect(state.logged).toEqual([
      '[desktop] dropped input for ended session agent',
      '[desktop] dropped resize for ended session agent',
    ]);
  });

  it('drops them for a session that is gone altogether', () => {
    expect(() => writeSession('gone', 'x')).not.toThrow();
    expect(() => resizeSession('gone', 80, 24)).not.toThrow();
  });

  it('logs a resize whose PTY closed before its exit was reported', () => {
    const e = entry();
    e.pty.resize.mockImplementation(() => {
      throw new Error('ioctl(2) failed, EBADF');
    });
    expect(() => resizeSession('agent', 80, 24)).not.toThrow();
    expect(state.logged).toEqual(['[desktop] resize failed for agent']);
  });
});
