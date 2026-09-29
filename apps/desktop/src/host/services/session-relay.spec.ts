import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RelayModule from './session-relay.js';
import type * as WatchModule from './session-watch.js';

/**
 * Where a session's output goes: into its ring buffer always, and to a
 * window only while that window watches the session. A session nobody
 * shows must cost no renderer anything, and a window that stops showing
 * it — by unmounting its terminal, reloading or closing — must stop
 * receiving it and stop counting its output as seen.
 */

const state = vi.hoisted(() => ({
  onData: new Map<string, (data: string) => void>(),
  shown: new Map<string, number>(),
}));

vi.mock('@n10/core', () => ({
  getSession: (name: string) => ({
    pty: {
      onData: (cb: (data: string) => void) => state.onData.set(name, cb),
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

describe('session output relay', () => {
  it('buffers a session nobody watches without sending it anywhere', () => {
    const entry = start('a');
    print('a', 'hello');
    expect(sent).toEqual([]);
    expect(relay.relayBuffer(entry)).toEqual({ data: 'hello', seq: 1 });
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

describe('watching as seeing', () => {
  it('shows the terminal once per window, until that window lets go', () => {
    watch.watch(1, 'a');
    watch.watch(1, 'a');
    watch.watch(2, 'a');
    expect(state.shown.get('a')).toBe(2);
    watch.unwatch(1, 'a');
    expect(state.shown.get('a')).toBe(2);
    watch.unwatch(1, 'a');
    watch.dropViewer(2);
    expect(state.shown.get('a')).toBe(0);
  });

  it('ignores an unwatch it never saw a watch for', () => {
    watch.unwatch(1, 'a');
    watch.watch(1, 'a');
    watch.unwatch(2, 'a');
    expect(state.shown.get('a')).toBe(1);
  });
});
