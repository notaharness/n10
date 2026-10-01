/**
 * The session host: every host service, every PTY attach client and
 * its emulator, ring buffer and relay, discovery, babysitters and the
 * beam client, in an Electron utility process named `n10 host`. The
 * main process keeps the windows and forwards the contract to it
 * (`host-process.ts`). A utility process, not a worker thread: node-pty
 * is not safe off the main thread of its process, and a utility
 * process may create the tmux server without inheriting the browser's
 * descriptors.
 */
// First: nothing the host starts may inherit the module it preloaded.
import './host-env-restore.js';
import { applySessionBackend, killAll, probeTmuxAvailability } from '@n10/core';
import { installHostPushes } from '../host/host-pushes.js';
import {
  registerHostHandlers,
  setExternalOpener,
  setFolderPicker,
  setShellGlue,
} from '../host/register-handlers.js';
import { stopAllBabysitters } from '../host/services/babysit.js';
import { stopDiscovery } from '../host/services/discovery.js';
import { installMachineResolver } from '../host/services/remote-machines.js';
import { stopRemoteSyncLoop } from '../host/services/remote-sync.js';
import { openStartupRepo } from '../host/services/repo.js';
import { dropViewer } from '../host/services/session-watch.js';
import { setTheme } from '../host/services/theme.js';
import { appBeamClient } from './beam/app-beam.js';
import type { DaemonExit, OwnedDaemon } from './beam/owned-daemon.js';
import {
  errorText,
  type HostToMain,
  type MainToHost,
  type ShellCalls,
} from './host-protocol.js';
import { installSessionBin } from './session-env.js';

const port = process.parentPort;
const post = (message: HostToMain) => port.postMessage(message);

// ── Calls into the main process ──────────────────────────────────

let nextCall = 0;
const calls = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

function callMain<K extends keyof ShellCalls>(
  method: K,
  ...args: Parameters<ShellCalls[K]>
): ReturnType<ShellCalls[K]> {
  const id = ++nextCall;
  return new Promise<unknown>((resolve, reject) => {
    calls.set(id, { resolve, reject });
    post({ t: 'call', id, method, args });
  }) as ReturnType<ShellCalls[K]>;
}

const logFailure = (what: string) => (err: unknown) =>
  console.error(`[host] ${what}`, err);

let nextDaemon = 0;
const daemonExits = new Map<number, (exit: DaemonExit) => void>();

/** A beam daemon the main process forks and owns on the host's behalf. */
function remoteDaemon(env: Record<string, string>): OwnedDaemon {
  const daemon = ++nextDaemon;
  const exited = new Promise<DaemonExit>((resolve) =>
    daemonExits.set(daemon, resolve)
  );
  callMain('spawnDaemon', daemon, env).catch((err: unknown) =>
    daemonExits.get(daemon)?.({
      code: null,
      signal: null,
      error: errorText(err),
    })
  );
  return {
    exited,
    stop: () =>
      void callMain('stopDaemon', daemon).catch(logFailure('stop beam')),
    kill: () =>
      void callMain('killDaemon', daemon).catch(logFailure('kill beam')),
  };
}

const beam = appBeamClient(remoteDaemon);

// ── The contract ─────────────────────────────────────────────────

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
registerHostHandlers({ handle: (channel, fn) => handlers.set(channel, fn) });

async function answer(
  message: Extract<MainToHost, { t: 'invoke' }>
): Promise<void> {
  const { id, channel, viewer, args } = message;
  try {
    const fn = handlers.get(channel);
    if (!fn) throw new Error(`No host handler for ${channel}`);
    const value = await fn({ sender: { id: viewer } }, ...args);
    post({ t: 'result', id, ok: true, value });
  } catch (err) {
    post({ t: 'result', id, ok: false, error: errorText(err) });
  }
}

function settle(message: Extract<MainToHost, { t: 'reply' }>): void {
  const call = calls.get(message.id);
  calls.delete(message.id);
  if (!call) return;
  if (message.ok) call.resolve(message.value);
  else call.reject(new Error(message.error));
}

// Terminal clients go; the tmux sessions behind them stay. Then the
// daemon this host started stops (D15).
async function shutdown(): Promise<void> {
  const removals = stopRemoteSyncLoop();
  stopDiscovery();
  stopAllBabysitters();
  try {
    killAll();
  } catch {
    // nothing was running
  }
  await beam.shutdown().catch(logFailure('beam shutdown'));
  await removals;
  post({ t: 'stopped' });
  setImmediate(() => process.exit(0));
}

port.on('message', ({ data }: { data: MainToHost }) => {
  switch (data.t) {
    case 'invoke':
      void answer(data);
      return;
    case 'reply':
      settle(data);
      return;
    case 'drop-viewer':
      dropViewer(data.viewer);
      return;
    case 'theme':
      setTheme(data.theme);
      return;
    case 'daemon-exit':
      daemonExits.get(data.daemon)?.(data.exit);
      return;
    case 'shutdown':
      void shutdown();
      return;
  }
});

// ── Startup ──────────────────────────────────────────────────────

async function start(): Promise<void> {
  const userData = process.env.N10_USER_DATA;
  if (userData) installSessionBin(userData);
  installHostPushes({
    broadcast: (channel, payload) => post({ t: 'broadcast', channel, payload }),
    sendTo: (viewer, channel, payload) =>
      post({ t: 'send', viewer, channel, payload }),
  });
  setFolderPicker((title) => callMain('pickFolder', title));
  setExternalOpener((url) => callMain('openExternal', url));
  setShellGlue({
    contextMenu: (items) => callMain('contextMenu', items),
    appMenuPopup: () => callMain('appMenuPopup'),
    aboutBox: () => callMain('aboutBox'),
    prefsChanged: (next) =>
      void callMain('prefsChanged', next).catch(logFailure('prefs')),
  });
  installMachineResolver();
  beam.start();
  await probeTmuxAvailability();
  applySessionBackend();
  const opened = openStartupRepo();
  post({ t: 'ready', repo: opened ? opened.cwd : null });
}

start().catch((err: unknown) => post({ t: 'fatal', message: errorText(err) }));
