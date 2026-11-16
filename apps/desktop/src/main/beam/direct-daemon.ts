import { spawn } from 'node:child_process';
import type { DaemonExit, OwnedDaemon } from './owned-daemon.js';
import { beamBinary } from './paths.js';

/**
 * Starts `beam daemon` as the host's own child: what a host behind a
 * pipe (`n10 host --stdio`) does, having no Electron main process to
 * fork it from and no browser descriptors to keep from it. Otherwise
 * as `beam-daemon-worker.ts`: the daemon stops at EOF on the stdin
 * this holds, and its output goes to stderr, since the host's stdout
 * is the protocol's.
 */
export function spawnDirectDaemon(env: Record<string, string>): OwnedDaemon {
  let lastLine = '';
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(beamBinary(), ['daemon', '--exit-with-parent'], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return {
      exited: Promise.resolve({ code: null, signal: null, error }),
      stop: () => undefined,
      kill: () => undefined,
    };
  }
  const relay = (chunk: Buffer) => {
    process.stderr.write(chunk);
    const lines = chunk.toString('utf8').trim().split('\n');
    lastLine = lines[lines.length - 1] || lastLine;
  };
  child.stdout?.on('data', relay);
  child.stderr?.on('data', relay);
  const exited = new Promise<DaemonExit>((resolve) => {
    child.once('error', (error) =>
      resolve({ code: null, signal: null, error: error.message })
    );
    child.once('exit', (code, signal) =>
      // Its last words get a moment to arrive.
      setTimeout(() => resolve({ code, signal, lastLine }), 200)
    );
  });
  return {
    exited,
    stop: () => child.stdin?.end(),
    kill: () => child.kill('SIGKILL'),
  };
}
