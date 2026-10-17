import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RelayModule from './session-relay.js';
import type * as WatchModule from './session-watch.js';

/**
 * Where a session's output goes: into its ring buffer always, and to a
 * window only while that window watches the session. A session nobody
 * holds a terminal for must cost no renderer anything, and a window
 * that lets go of it — by unmounting its terminal, reloading or closing
 * — must stop receiving it. Its output is seen only while on screen.
 */

const state = vi.hoisted(() => ({
  onData: new Map<string, (data: string) => void>(),
  onAttach: new Map<string, () => void>(),
  shown: new Map<string, number>(),
}));

vi.mock('@n10/core', () => ({
  getSession: (name: string) => ({
    pty: {
      onData: (cb: (data: string) => void) => state.onData.set(name, cb),
      onAttach: (cb: () => void) => state.onAttach.set(name, cb),
      onExit: () => undefined,
    },
  }),
  hasPersistedTerminalSession: () => false,
  showTerminal: (name: string) => {
    state.shown.set(name, (state.shown.get(name) ?? 0) + 1);
    return () => state.shown.set(name, (state.shown.get(name) ?? 0) - 1);
  },
}));

let relay: typeof RelayModule;
let watch: typeof WatchModule;
let sent: { viewer: number; channel: string; payload: unknown }[];

beforeEach(async () => {
  state.onData = new Map();
  state.onAttach = new Map();
  state.shown = new Map();
  sent = [];
  vi.resetModules();
  relay = await import('./session-relay.js');
  watch = await import('./session-watch.js');
  relay.setSessionBroadcaster(
    () => undefined,
    (viewer, channel, payload) => sent.push({ viewer, channel, payload })
  );
});

function start(name: string): RelayModule.RelayEntry {
  const entry = relay.newRelayEntry();
  relay.attachRelay(name, entry);
  return entry;
}

const print = (name: string, data: string) => state.onData.get(name)?.(data);
/** A new tmux client: announced, then its first output. */
const reattach = (name: string, data: string) => {
  state.onAttach.get(name)?.();
  print(name, data);
};

describe('session output relay', () => {
  it('buffers a session nobody watches without sending it anywhere', () => {
    const entry = start('a');
    print('a', 'hello');
    expect(sent).toEqual([]);
    expect(relay.relayBuffer(entry)).toEqual({
      data: 'hello',
      seq: 1,
      truncated: false,
    });
  });

  it("says when output after the client's first has been dropped", () => {
    const entry = start('a');
    print('a', 'setup');
    print('a', 'x'.repeat(300 * 1024));
    expect(relay.relayBuffer(entry).truncated).toBe(false);
    print('a', 'y'.repeat(300 * 1024));
    const buffer = relay.relayBuffer(entry);
    expect(buffer.truncated).toBe(true);
    expect(buffer.seq).toBe(3);
  });

  // tmux sets the client's terminal up (alternate screen, cursor keys,
  // bracketed paste) once, in its first output: a snapshot that lost
  // it would start a terminal without them.
  it("keeps the client's first output ahead of whatever the ring drops", () => {
    const entry = start('a');
    print('a', 'setup');
    print('a', 'x'.repeat(300 * 1024));
    print('a', 'y'.repeat(300 * 1024));
    expect(relay.relayBuffer(entry).data).toBe(
      'setup' + 'y'.repeat(300 * 1024)
    );
  });

  it("starts over at a new client's first output", () => {
    const entry = start('a');
    reattach('a', 'setup');
    print('a', 'x'.repeat(300 * 1024));
    print('a', 'y'.repeat(300 * 1024));
    reattach('a', 'setup again');
    print('a', 'z');
    expect(relay.relayBuffer(entry)).toEqual({
      data: 'setup againz',
      seq: 5,
      truncated: false,
    });
  });

  it('sends a watched session to the watching window only', () => {
    start('a');
    start('b');
    watch.watch(1, 'a');
    watch.watch(2, 'b');
    print('a', 'for one');
    expect(sent).toEqual([
      {
        viewer: 1,
        channel: 'n10/session/data',
        payload: { name: 'a', data: 'for one', seq: 1 },
      },
    ]);
  });

  it('keeps sending until every watch a window holds is released', () => {
    start('a');
    watch.watch(1, 'a');
    watch.watch(1, 'a');
    watch.unwatch(1, 'a');
    print('a', 'still');
    expect(sent.map((s) => s.viewer)).toEqual([1]);
    watch.unwatch(1, 'a');
    print('a', 'gone');
    expect(sent).toHaveLength(1);
  });

  it('forgets a window whose page went away, whatever it still held', () => {
    start('a');
    start('b');
    watch.watch(1, 'a');
    watch.watch(1, 'b');
    watch.watch(2, 'a');
    watch.dropViewer(1);
    print('a', 'x');
    print('b', 'y');
    expect(sent.map((s) => s.viewer)).toEqual([2]);
  });
});

describe('seeing', () => {
  it('is being on screen, not holding a terminal', () => {
    watch.watch(1, 'a');
    expect(state.shown.get('a')).toBeUndefined();
    watch.show(1, 'a');
    expect(state.shown.get('a')).toBe(1);
  });

  it('shows the terminal once per window, until that window lets go', () => {
    watch.show(1, 'a');
    watch.show(1, 'a');
    watch.show(2, 'a');
    expect(state.shown.get('a')).toBe(2);
    watch.hide(1, 'a');
    expect(state.shown.get('a')).toBe(2);
    watch.hide(1, 'a');
    watch.dropViewer(2);
    expect(state.shown.get('a')).toBe(0);
  });

  it('ignores a hide it never saw a show for', () => {
    watch.hide(1, 'a');
    watch.show(1, 'a');
    watch.hide(2, 'a');
    expect(state.shown.get('a')).toBe(1);
  });
});
