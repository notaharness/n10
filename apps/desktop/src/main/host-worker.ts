/**
 * The session host: every host service, every PTY attach client and
 * its emulator, ring buffer and relay, discovery, auto-fixers and the
 * beam client, in an Electron utility process named `n10 host` or,
 * behind a pipe, as `n10 host --stdio` in WSL or on an SSH machine
 * (`host-channel.ts`). The main process keeps the windows and forwards
 * the contract to it (`host-process.ts`). A utility process, not a worker thread: node-pty
 * is not safe off the main thread of its process, and a utility
 * process may create the tmux server without inheriting the browser's
 * descriptors.
 */
// First: nothing the host starts may inherit the module it preloaded.
import './host-env-restore.js';
import { startUpdates, stopUpdates } from '../host/services/updates.js';
import { applySessionBackend, killAll, probeTmuxAvailability } from '@n10/core';
import { installHostPushes } from '../host/host-pushes.js';
import {
  registerHostHandlers,
  setExternalOpener,
  setFolderPicker,
  setShellGlue,
} from '../host/register-handlers.js';
import { stopAllAutoFixers } from '../host/services/auto-fix.js';
import { stopDiscovery } from '../host/services/discovery.js';
import { installMachineResolver } from '../host/services/remote-machines.js';
import { stopRemoteSyncLoop } from '../host/services/remote-sync.js';
import { openStartupRepo } from '../host/services/repo.js';
import { dropViewer } from '../host/services/session-watch.js';
import { setTheme } from '../host/services/theme.js';
import { setLaunchRepoClaim, setMenuShortcutHold } from '../host/viewer-api.js';
import { appBeamClient } from './beam/app-beam.js';
import { spawnDirectDaemon } from './beam/direct-daemon.js';
import type { DaemonExit, OwnedDaemon } from './beam/owned-daemon.js';
import { openHostChannel } from './host-channel.js';
import { takeHostLock, type HostLock } from './host-lock.js';
import {
  errorText,
  type HostToMain,
  type MainToHost,
  type ShellCalls,
} from './host-protocol.js';
import { installSessionBin } from './session-env.js';

const channel = openHostChannel();
const post = (message: HostToMain) => channel.post(message);

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

// Behind a pipe there is no Electron main process to fork it, and no
// browser descriptors to keep from it.
const beam = appBeamClient(channel.remote ? spawnDirectDaemon : remoteDaemon);

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
let shuttingDown = false;
/** Behind a pipe: this user's one host on the machine. */
let lock: HostLock | null = null;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (lock?.replaced()) post({ t: 'replaced' });
  stopUpdates();
  const removals = stopRemoteSyncLoop();
  stopDiscovery();
  stopAllAutoFixers();
  try {
    killAll();
  } catch {
    // nothing was running
  }
  await beam.shutdown().catch(logFailure('beam shutdown'));
  await removals;
  lock?.release();
  post({ t: 'stopped' });
  setImmediate(() => process.exit(0));
}

function onMessage(data: MainToHost): void {
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
}

// A frontend that went without saying so (its app crashed, the
// connection dropped) is a shutdown too: sessions detach, never end.
channel.listen(onMessage, () => void shutdown());

// ── Startup ──────────────────────────────────────────────────────

async function start(): Promise<void> {
  const startDir = process.env.N10_START_DIR;
  delete process.env.N10_START_DIR;
  const userData = process.env.N10_USER_DATA;
  if (channel.remote && userData) lock = await takeHostLock(userData);
  if (userData) installSessionBin(userData);
  installHostPushes({
    broadcast: (channel, payload) => post({ t: 'broadcast', channel, payload }),
    sendTo: (viewer, channel, payload) =>
      post({ t: 'send', viewer, channel, payload }),
  });
  setFolderPicker((title) => callMain('pickFolder', title));
  setExternalOpener((url) => callMain('openExternal', url));
  setShellGlue({
    quitForUpdate: () => callMain('quitForUpdate'),
    quitForNpmUpdate: (plan) => callMain('quitForNpmUpdate', plan),
    contextMenu: (items) => callMain('contextMenu', items),
    appMenuPopup: () => callMain('appMenuPopup'),
    aboutBox: () => callMain('aboutBox'),
    hostTarget: () => callMain('hostTarget'),
    prefsChanged: (next) =>
      void callMain('prefsChanged', next).catch(logFailure('prefs')),
  });
  setMenuShortcutHold((viewer, held) =>
    callMain('holdMenuShortcuts', viewer, held)
  );
  setLaunchRepoClaim((viewer) => callMain('takeLaunchRepo', viewer));
  installMachineResolver();
  await probeTmuxAvailability();
  applySessionBackend();
  beam.start();
  const opened = openStartupRepo({ N10_START_DIR: startDir });
  // A host behind a pipe is updated where it is installed, not by the
  // frontend's updater.
  if (!channel.remote) startUpdates();
  post({ t: 'ready', repo: opened ? opened.cwd : null });
}

start().catch((err: unknown) => post({ t: 'fatal', message: errorText(err) }));
