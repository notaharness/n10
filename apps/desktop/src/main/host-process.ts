/**
 * The main process's side of the session host (`host-worker.ts`): it
 * forks the host, forwards every contract channel to it, carries its
 * pushes to the windows and answers what it asks of the shell.
 *
 * A host that dies is forked again (`host-restarts.ts` says when). Its
 * tmux sessions outlive it; the new host's discovery attaches to them
 * as it would after a restart of the app, and each window reloads so
 * its terminals watch the new host. Calls in flight when it died fail;
 * calls made while it starts again wait for it, for a while. A host
 * that keeps dying is given up on: every call fails from then on, and
 * the user is told.
 */
import { join } from 'node:path';
import { app, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { IPC } from '../host/contract.js';
import type { HostPushes } from '../host/host-pushes.js';
import { spawnOwnedDaemon, type OwnedDaemon } from './beam/owned-daemon.js';
import { newGate, within } from './host-gate.js';
import { hostEnv } from './host-env.js';
import {
  errorText,
  type HostToMain,
  type MainToHost,
  type ShellCalls,
} from './host-protocol.js';
import { RestartPolicy } from './host-restarts.js';

/** How long quitting waits for the host to let go of its sessions. */
const STOP_TIMEOUT_MS = 10_000;
/** How long a call waits for a host that is starting again. */
const CALL_WAIT_MS = 30_000;

/** What the user reads when the host is not there to answer. */
export const HOST_UNAVAILABLE = {
  restarted: 'n10 restarted. Try again.',
  failed:
    'n10 stopped working and could not start again. Your agents are still running: quit n10 and open it again.',
  stoppedStarting:
    'n10 stopped while starting. Open it again, and if it keeps happening, run it from a terminal to see why.',
};

type Shell = Omit<ShellCalls, 'spawnDaemon' | 'stopDaemon' | 'killDaemon'>;

export interface HostProcessOptions {
  startDir?: string;
  shell: Shell;
  pushes: HostPushes;
  /** A host was forked again and is ready. */
  onRespawn: () => void;
  /** The host kept dying and will not be forked again; `message` says
   *  so in the user's terms. */
  onFailed: (message: string) => void;
}

export interface HostProcess {
  /** Resolves with the startup repo once the first host is ready;
   *  rejects with why it could not start (tmux missing, …). */
  readonly started: Promise<string | null>;
  dropViewer(viewer: number): void;
  /** Lets the host release its terminal clients and beam, then stops
   *  any daemon a host that died left behind. */
  stop(): Promise<void>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export function startHostProcess(options: HostProcessOptions): HostProcess {
  const daemons = new Map<number, OwnedDaemon>();
  const pending = new Map<number, Pending>();
  const restarts = new RestartPolicy();
  let nextInvoke = 0;
  let child: UtilityProcess | null = null;
  let gate = newGate();
  let failed: Error | null = null;
  let respawn: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;
  let first = true;
  let startedResolve!: (repo: string | null) => void;
  let startedReject!: (err: Error) => void;
  const started = new Promise<string | null>((resolve, reject) => {
    startedResolve = resolve;
    startedReject = reject;
  });

  const post = (message: MainToHost) => child?.postMessage(message);

  const shellCalls: ShellCalls = {
    ...options.shell,
    spawnDaemon: async (daemon, env) => {
      const owned = spawnOwnedDaemon(env);
      daemons.set(daemon, owned);
      const host = child;
      void owned.exited.then((exit) => {
        daemons.delete(daemon);
        if (child === host) post({ t: 'daemon-exit', daemon, exit });
      });
    },
    stopDaemon: async (daemon) => daemons.get(daemon)?.stop(),
    killDaemon: async (daemon) => daemons.get(daemon)?.kill(),
  };

  // A shell call can outlast the host that made it (a folder picker
  // stays open as long as the user leaves it), and a new host numbers
  // its calls from the start again: the answer goes to the host that
  // asked, or nowhere.
  async function serve(
    host: UtilityProcess,
    { id, method, args }: Extract<HostToMain, { t: 'call' }>
  ) {
    const reply = (message: MainToHost) => {
      if (child === host) post(message);
    };
    try {
      const fn = shellCalls[method] as (...a: unknown[]) => Promise<unknown>;
      reply({ t: 'reply', id, ok: true, value: await fn(...args) });
    } catch (err) {
      reply({ t: 'reply', id, ok: false, error: errorText(err) });
    }
  }

  function settle(message: Extract<HostToMain, { t: 'result' }>): void {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (!call) return;
    if (message.ok) call.resolve(message.value);
    else call.reject(new Error(message.error));
  }

  function onReady(repo: string | null): void {
    gate.open();
    restarts.ready();
    if (!first) return options.onRespawn();
    first = false;
    startedResolve(repo);
  }

  // A host that cannot start says why and is stopped; its exit decides
  // what happens next.
  function onFatal(host: UtilityProcess, message: string): void {
    if (first) startedReject(new Error(message));
    else console.error('[desktop] host could not start again:', message);
    host.kill();
  }

  function onMessage(host: UtilityProcess, message: HostToMain): void {
    switch (message.t) {
      case 'result':
        return settle(message);
      case 'send':
        return options.pushes.sendTo(
          message.viewer,
          message.channel,
          message.payload
        );
      case 'broadcast':
        return options.pushes.broadcast(message.channel, message.payload);
      case 'call':
        void serve(host, message);
        return;
      case 'ready':
        return onReady(message.repo);
      case 'fatal':
        return onFatal(host, message.message);
      case 'stopped':
        return;
    }
  }

  function giveUp(): void {
    failed = new Error(HOST_UNAVAILABLE.failed);
    gate.fail(failed);
    options.onFailed(HOST_UNAVAILABLE.failed);
  }

  function onExit(host: UtilityProcess, code: number): void {
    if (child !== host) return;
    child = null;
    for (const call of pending.values()) {
      call.reject(new Error(HOST_UNAVAILABLE.restarted));
    }
    pending.clear();
    if (stopping) return;
    if (first)
      return startedReject(new Error(HOST_UNAVAILABLE.stoppedStarting));
    // Calls from here on wait for the next host.
    if (gate.settled) gate = newGate();
    const delay = restarts.ended();
    if (delay === null) return giveUp();
    console.error(`[desktop] host exited (${code}); starting it again`);
    respawn = setTimeout(() => {
      respawn = null;
      if (!stopping) fork();
    }, delay);
  }

  function fork(): void {
    const host = utilityProcess.fork(
      join(import.meta.dirname, 'host-worker.js'),
      [],
      {
        serviceName: 'n10 host',
        stdio: 'inherit',
        env: hostEnv(process.env, app.getPath('userData'), options.startDir),
      }
    );
    child = host;
    host.on('message', (message: HostToMain) => onMessage(host, message));
    host.once('exit', (code) => onExit(host, code));
  }

  async function invoke(channel: string, viewer: number, args: unknown[]) {
    if (failed) throw failed;
    await within(gate.promise, CALL_WAIT_MS, HOST_UNAVAILABLE.restarted);
    return new Promise<unknown>((resolve, reject) => {
      if (!child) return reject(new Error(HOST_UNAVAILABLE.restarted));
      const id = ++nextInvoke;
      pending.set(id, { resolve, reject });
      post({ t: 'invoke', id, channel, viewer, args });
    });
  }

  for (const channel of Object.values(IPC)) {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      invoke(channel, event.sender.id, args)
    );
  }

  async function stop(): Promise<void> {
    stopping = true;
    if (respawn) clearTimeout(respawn);
    const host = child;
    if (host) {
      const exited = new Promise<void>((resolve) =>
        host.once('exit', () => resolve())
      );
      post({ t: 'shutdown' });
      const timer = setTimeout(() => host.kill(), STOP_TIMEOUT_MS);
      await exited;
      clearTimeout(timer);
    }
    const left = [...daemons.values()];
    for (const daemon of left) daemon.stop();
    await Promise.all(left.map((daemon) => daemon.exited));
  }

  fork();
  return {
    started,
    dropViewer: (viewer) => post({ t: 'drop-viewer', viewer }),
    stop,
  };
}
