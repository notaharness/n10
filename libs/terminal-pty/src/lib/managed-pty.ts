import * as pty from 'node-pty';
import type { ManagedTarget, SessionBackend, SessionSpec } from '@n10/terminal';

/** Output a newly attached handle replays before live data: enough for
 *  a full-screen program's last frame and some scrollback. */
export const REPLAY_BYTES = 512 * 1024;

type ExitListener = (code: number, signal?: number) => void;

const HANGUP = 1;

/** What the holder of a session hears about it. */
export interface ManagedPtyEvents {
  /** A process ended on its own. */
  ended?(exit: ManagedExit): void;
  /** The session was stopped, from any handle or by its holder. */
  stopped?(): void;
}

/** The facts a managed session keeps once its process has ended. */
export interface ManagedExit {
  exitCode: number;
  signal?: number;
}

function shellCommand(spec: SessionSpec): [string, string[]] {
  if (spec.cmd) return [spec.cmd, spec.args];
  return [spec.env?.['SHELL'] || process.env['SHELL'] || '/bin/sh', ['-l']];
}

/**
 * One managed session's process side: the PTY it runs now, the facts of
 * the last process that ended, and the handles attached to it. Each
 * launch is a new `generation`. Handles release without stopping it;
 * only `stop` ends it.
 */
export class ManagedPty {
  private process: pty.IPty | null = null;
  private launches = 0;
  private ended: ManagedExit | null = null;
  private removed = false;
  private replay: string[] = [];
  private replayLength = 0;
  private readonly handles = new Set<ManagedPtyHandle>();

  constructor(
    readonly target: ManagedTarget,
    spec: SessionSpec,
    private readonly events: ManagedPtyEvents = {}
  ) {
    this.launch(spec);
  }

  get generation(): number {
    return this.launches;
  }

  get running(): boolean {
    return this.process !== null;
  }

  get exit(): ManagedExit | null {
    return this.ended;
  }

  get gone(): boolean {
    return this.removed;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  get cols(): number {
    return this.process?.cols ?? 0;
  }

  get rows(): number {
    return this.process?.rows ?? 0;
  }

  /** Start the next generation in a session whose process ended. */
  launch(spec: SessionSpec): void {
    if (this.process) throw new Error('The session is still running');
    if (this.removed) throw new Error('The session was stopped');
    const [cmd, args] = shellCommand(spec);
    const child = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: (spec.env ?? process.env) as Record<string, string>,
    });
    this.process = child;
    this.launches += 1;
    this.ended = null;
    child.onData((data) => {
      if (this.process === child) this.output(data);
    });
    child.onExit(({ exitCode, signal }) => {
      if (this.process !== child) return;
      this.process = null;
      this.ended = { exitCode, ...(signal ? { signal } : {}) };
      for (const handle of [...this.handles]) handle.exited(exitCode, signal);
      this.events.ended?.(this.ended);
    });
  }

  /** Replace the running process with a new generation. Attached
   *  handles stay attached and see no exit in between. */
  replace(spec: SessionSpec): void {
    this.end();
    this.launch(spec);
  }

  /** End the session: its process, if running, and every handle. */
  stop(): void {
    if (this.removed) return;
    this.removed = true;
    // node-pty hangs up the terminal, which ends its session's
    // processes. A process that already ended reported its exit.
    if (this.end()) {
      this.ended = { exitCode: 0, signal: HANGUP };
      for (const handle of [...this.handles]) handle.exited(0, HANGUP);
    }
    this.handles.clear();
    this.events.stopped?.();
  }

  /** Kill the running process without reporting its exit. */
  private end(): boolean {
    const child = this.process;
    if (!child) return false;
    this.process = null;
    try {
      child.kill();
    } catch {
      // already gone
    }
    return true;
  }

  /** A new connection, which first receives the retained output. */
  attach(): ManagedPtyHandle {
    if (this.removed) throw new Error('The session was stopped');
    const handle = new ManagedPtyHandle(this, this.replay.join(''));
    this.handles.add(handle);
    return handle;
  }

  /** @internal */
  release(handle: ManagedPtyHandle): void {
    this.handles.delete(handle);
  }

  write(data: string): void {
    this.process?.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process?.resize(cols, rows);
  }

  private output(data: string): void {
    this.replay.push(data);
    this.replayLength += data.length;
    while (this.replayLength > REPLAY_BYTES && this.replay.length > 1)
      this.replayLength -= this.replay.shift()!.length;
    for (const handle of [...this.handles]) handle.data(data);
  }
}

/**
 * One connection to a managed session. `dispose` releases it and
 * leaves the session running; `kill` stops the session.
 */
export class ManagedPtyHandle implements SessionBackend {
  private dataListeners: ((data: string) => void)[] = [];
  private exitListeners: ExitListener[] = [];
  private attachListeners: (() => void)[] = [];
  private pending: string | null;
  private released = false;

  constructor(private readonly session: ManagedPty, replay: string) {
    this.pending = replay;
  }

  get target(): ManagedTarget {
    return this.session.target;
  }

  get processState(): NonNullable<SessionBackend['processState']> {
    const exit = this.session.exit;
    return {
      running: this.session.running,
      ...(exit ? { exitCode: exit.exitCode } : {}),
      ...(exit?.signal ? { signal: exit.signal } : {}),
      ...(this.session.gone ? { gone: true } : {}),
    };
  }

  get pid(): number {
    return this.session.pid ?? 0;
  }

  get cols(): number {
    return this.session.cols;
  }

  get rows(): number {
    return this.session.rows;
  }

  write(data: string): void {
    if (!this.released) this.session.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.released) this.session.resize(cols, rows);
  }

  /** The first listener receives the retained output on the next tick,
   *  ahead of anything the process writes after it. */
  onData(cb: (data: string) => void): void {
    this.dataListeners.push(cb);
    if (this.pending !== null) queueMicrotask(() => this.flush());
  }

  offData(cb: (data: string) => void): void {
    this.dataListeners = this.dataListeners.filter((other) => other !== cb);
  }

  onExit(cb: ExitListener): void {
    this.exitListeners.push(cb);
  }

  offExit(cb: ExitListener): void {
    this.exitListeners = this.exitListeners.filter((other) => other !== cb);
  }

  onAttach(cb: () => void): void {
    this.attachListeners.push(cb);
  }

  offAttach(cb: () => void): void {
    this.attachListeners = this.attachListeners.filter((other) => other !== cb);
  }

  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.dataListeners = [];
    this.session.release(this);
  }

  kill(): void {
    this.session.stop();
    this.dispose();
  }

  /** @internal */
  data(data: string): void {
    if (this.released) return;
    if (this.pending !== null) {
      this.pending += data;
      return;
    }
    for (const listener of [...this.dataListeners]) listener(data);
  }

  /** @internal */
  exited(code: number, signal?: number): void {
    this.flush();
    for (const listener of [...this.exitListeners]) listener(code, signal);
  }

  private flush(): void {
    const replay = this.pending;
    if (replay === null) return;
    this.pending = null;
    for (const listener of [...this.attachListeners]) listener();
    if (replay)
      for (const listener of [...this.dataListeners]) listener(replay);
  }
}
