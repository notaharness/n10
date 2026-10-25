/**
 * The main process's end of its channel to one session host: a utility
 * process it forks (`local`), or a host it starts behind a pipe
 * (`wsl.exe …`, `ssh …`, see `host-target.ts`) and speaks
 * `host-wire.ts` to. `host-process.ts` sees only this.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { UtilityProcess } from 'electron';
import type { HostToMain, MainToHost } from './host-protocol.js';
import { hostLabel, type HostTarget } from './host-target.js';
import {
  encodeFrame,
  HOST_PROTOCOL,
  lineReader,
  parseLine,
  type HostHello,
} from './host-wire.js';

export interface HostLink {
  post(message: MainToHost): void;
  onMessage(fn: (message: HostToMain) => void): void;
  onceExit(fn: (code: number) => void): void;
  kill(): void;
}

export function utilityLink(host: UtilityProcess): HostLink {
  return {
    post: (message) => host.postMessage(message),
    onMessage: (fn) => host.on('message', fn),
    onceExit: (fn) => host.once('exit', fn),
    kill: () => void host.kill(),
  };
}

/** Why a host's hello is refused, or null when it is not. */
export function refuseHello(
  hello: HostHello,
  frontendVersion: string
): string | null {
  if (hello.platform === 'win32') {
    return 'The n10 found there is a Windows install. Install n10 inside Linux, with Linux Node.js and npm.';
  }
  if (hello.protocol !== HOST_PROTOCOL) {
    return `It runs n10 ${hello.version}, which this n10 (${frontendVersion}) cannot talk to. Install the same version there: npm install -g @notaharness/n10@${frontendVersion}`;
  }
  return null;
}

/** Lines of the host's stderr kept for an error that has no other
 *  explanation. */
const STDERR_LINES = 8;

export interface PipeLinkOptions {
  target: Exclude<HostTarget, { kind: 'local' }>;
  child: ChildProcess;
  frontendVersion: string;
  /** The host said hello and was accepted. */
  onHello: (hello: HostHello) => void;
}

/**
 * A host behind `child`'s stdin and stdout. Nothing is written to it
 * before its hello, which comes after whatever the login shell printed;
 * a host that ends before saying it, or says the wrong thing, reaches
 * `host-process.ts` as a `fatal` naming the target and what went wrong.
 */
export function pipeLink(options: PipeLinkOptions): HostLink {
  const { child, target } = options;
  const listeners: ((message: HostToMain) => void)[] = [];
  const queued: MainToHost[] = [];
  const stderr: string[] = [];
  let hello: HostHello | null = null;
  let failed = false;

  const deliver = (message: HostToMain) => {
    for (const fn of listeners) fn(message);
  };
  const where = hostLabel(target);
  const fail = (why: string) => {
    if (failed) return;
    failed = true;
    deliver({ t: 'fatal', message: `n10 could not start on ${where}. ${why}` });
    child.kill();
  };
  const write = (message: MainToHost) => {
    if (child.stdin?.writable) child.stdin.write(encodeFrame(message));
  };

  child.stdout?.on(
    'data',
    lineReader(
      (line) => {
        const parsed = parseLine(line);
        if (parsed.kind === 'message' && hello) {
          return deliver(parsed.message as HostToMain);
        }
        if (parsed.kind === 'hello' && !hello) {
          const refused = refuseHello(parsed.hello, options.frontendVersion);
          if (refused) return fail(refused);
          hello = parsed.hello;
          options.onHello(parsed.hello);
          for (const message of queued.splice(0)) write(message);
          return;
        }
        // The login shell's own output, before the host ran.
        if (line.trim()) console.error(`[host ${where}] ${line}`);
      },
      () => fail('Its output was not n10’s protocol.')
    )
  );
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    try {
      process.stderr.write(text);
    } catch {
      // no console to write to
    }
    stderr.push(...text.split('\n').filter((l) => l.trim()));
    stderr.splice(0, Math.max(0, stderr.length - STDERR_LINES));
  });
  // Writes to a host that has gone fail here rather than throw.
  child.stdin?.on('error', () => undefined);
  child.once('error', (error) => fail(spawnFailure(target, error)));
  child.once('exit', (code) => {
    if (hello) return;
    fail(
      code === 0
        ? 'It ended before it started.'
        : missingHint(stderr.join('\n'))
    );
  });

  return {
    post: (message) => {
      if (hello) write(message);
      else queued.push(message);
    },
    onMessage: (fn) => void listeners.push(fn),
    onceExit: (fn) => {
      child.once('exit', (code) => fn(code ?? 1));
    },
    kill: () => void child.kill(),
  };
}

function spawnFailure(target: HostTarget, error: Error): string {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return target.kind === 'wsl'
      ? 'WSL is not installed: run `wsl --install` from Windows.'
      : 'ssh was not found on this computer.';
  }
  return error.message;
}

/** The host's last words, with the fix when they say n10 is missing. */
export function missingHint(stderr: string): string {
  const said = stderr.trim();
  if (/n10: (command )?not found|n10: No such file/i.test(said)) {
    return `n10 is not installed there. Install it with Linux npm: npm install -g @notaharness/n10\n\n${said}`;
  }
  return said || 'It ended without saying why.';
}

export function spawnPipeHost(
  options: Omit<PipeLinkOptions, 'child'> & {
    file: string;
    args: string[];
  }
): HostLink {
  const child = spawn(options.file, options.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return pipeLink({ ...options, child });
}
