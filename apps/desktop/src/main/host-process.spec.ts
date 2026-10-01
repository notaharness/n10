import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC, type ResolvedTheme } from '../host/contract.js';
import type { HostToMain, MainToHost } from './host-protocol.js';
import { FIRST_DELAY_MS, MAX_DELAY_MS, MAX_RESTARTS } from './host-restarts.js';

/**
 * The main process's hold on the session host: what happens to calls,
 * and to the host, when it dies — once, while starting again, or every
 * time.
 */

class FakeHost extends EventEmitter {
  posted: MainToHost[] = [];
  postMessage(message: MainToHost) {
    this.posted.push(message);
  }
  kill = vi.fn(() => this.emit('exit', 1));
  say(message: HostToMain) {
    this.emit('message', message);
  }
  invokes() {
    return this.posted.filter((m) => m.t === 'invoke');
  }
}

const electron = vi.hoisted(() => ({
  forks: [] as unknown[],
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/data' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown) => unknown) =>
      electron.handlers.set(channel, fn),
  },
  utilityProcess: {
    fork: () => {
      const host = new FakeHost();
      electron.forks.push(host);
      return host;
    },
  },
}));
vi.mock('./beam/owned-daemon.js', () => ({ spawnOwnedDaemon: vi.fn() }));

const { HOST_UNAVAILABLE, startHostProcess } = await import(
  './host-process.js'
);

const hosts = () => electron.forks as FakeHost[];
const latest = () => hosts()[hosts().length - 1];
const call = () =>
  electron.handlers.get(IPC.getVersion)!({
    sender: { id: 1 },
  }) as Promise<unknown>;

let theme: ResolvedTheme = 'light';

function start(
  shell: Partial<Parameters<typeof startHostProcess>[0]['shell']> = {}
) {
  const onFailed = vi.fn();
  const onRespawn = vi.fn();
  const host = startHostProcess({
    shell: {
      pickFolder: async () => null,
      openExternal: async () => undefined,
      contextMenu: async () => null,
      appMenuPopup: async () => undefined,
      aboutBox: async () => undefined,
      prefsChanged: async () => undefined,
      ...shell,
    },
    pushes: { broadcast: () => undefined, sendTo: () => undefined },
    theme: () => theme,
    onRespawn,
    onFailed,
  });
  return { host, onFailed, onRespawn };
}

beforeEach(() => {
  vi.useFakeTimers();
  theme = 'light';
  electron.forks = [];
  electron.handlers.clear();
});
afterEach(() => vi.useRealTimers());

describe('the session host process', () => {
  it('says in plain words when the first host stops before it is ready', async () => {
    const { host } = start();
    latest().emit('exit', 1);
    await expect(host.started).rejects.toThrow(
      HOST_UNAVAILABLE.stoppedStarting
    );
  });

  it('gives up on a host that cannot start again, failing calls and telling the user', async () => {
    const { host, onFailed } = start();
    latest().say({ t: 'ready', repo: null });
    await host.started;

    latest().emit('exit', 1);
    const waiting = call();
    waiting.catch(() => undefined);
    for (let i = 0; i < MAX_RESTARTS; i++) {
      await vi.advanceTimersByTimeAsync(
        Math.min(FIRST_DELAY_MS * 2 ** i, MAX_DELAY_MS)
      );
      latest().say({ t: 'fatal', message: 'tmux is missing' });
      expect(latest().kill).toHaveBeenCalled();
    }

    expect(hosts()).toHaveLength(1 + MAX_RESTARTS);
    await expect(waiting).rejects.toThrow(HOST_UNAVAILABLE.failed);
    await expect(call()).rejects.toThrow(HOST_UNAVAILABLE.failed);
    expect(onFailed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(MAX_DELAY_MS * 4);
    expect(hosts()).toHaveLength(1 + MAX_RESTARTS);
  });

  it('tells every host the theme in effect when it starts, and when it changes', async () => {
    theme = 'dark';
    const { host } = start();
    const themes = () =>
      latest()
        .posted.filter((m) => m.t === 'theme')
        .map((m) => m.theme);
    expect(themes()).toEqual(['dark']);

    theme = 'light';
    host.themeChanged();
    expect(themes()).toEqual(['dark', 'light']);

    latest().say({ t: 'ready', repo: null });
    await host.started;
    latest().emit('exit', 1);
    await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);
    expect(themes()).toEqual(['light']);
  });

  it('holds a call made while the host starts again until it is ready', async () => {
    const { host, onRespawn } = start();
    latest().say({ t: 'ready', repo: null });
    await host.started;

    latest().emit('exit', 1);
    const waiting = call();
    await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);
    const next = latest();
    expect(next.invokes()).toEqual([]);
    next.say({ t: 'ready', repo: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(onRespawn).toHaveBeenCalledOnce();
    const [invoke] = next.invokes();
    next.say({ t: 'result', id: invoke!.id, ok: true, value: 'v' });
    await expect(waiting).resolves.toBe('v');
  });

  it('fails a call in flight when its host dies', async () => {
    const { host } = start();
    latest().say({ t: 'ready', repo: null });
    await host.started;
    const inFlight = call();
    inFlight.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    latest().emit('exit', 1);
    await expect(inFlight).rejects.toThrow(HOST_UNAVAILABLE.restarted);
  });

  it('starts no new host when the app quits while one is due', async () => {
    const { host } = start();
    latest().say({ t: 'ready', repo: null });
    await host.started;
    latest().emit('exit', 1);
    await host.stop();
    await vi.advanceTimersByTimeAsync(MAX_DELAY_MS * 2);
    expect(hosts()).toHaveLength(1);
  });

  it('answers a shell call only to the host that asked', async () => {
    let pick!: (path: string) => void;
    const { host } = start({
      pickFolder: () => new Promise((resolve) => (pick = resolve)),
    });
    const asking = latest();
    asking.say({ t: 'ready', repo: null });
    await host.started;
    asking.say({ t: 'call', id: 1, method: 'pickFolder', args: ['Open'] });

    asking.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(MAX_DELAY_MS);
    const next = latest();
    next.say({ t: 'ready', repo: null });
    pick('/picked');
    await vi.advanceTimersByTimeAsync(0);
    expect(next.posted.filter((m) => m.t === 'reply')).toEqual([]);
  });
});
