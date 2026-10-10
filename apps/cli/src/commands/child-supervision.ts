import type { ChildProcess } from 'node:child_process';
import { constants } from 'node:os';
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

/** A shell's exit status for how Electron ended: its code, or 128 plus
 *  the signal that killed it (SIGTRAP when the sandbox aborts). */
export function exitStatus(
  code: number | null,
  signal: NodeJS.Signals | null
): number {
  if (code !== null) return code;
  return signal ? 128 + constants.signals[signal] : 1;
}

/** Wait for a child and preserve its exit status. Separate process groups
 * need every stop signal forwarded. A foreground child already receives tty
 * INT/HUP, so absorb those in the parent and forward only TERM. */
export function superviseChild(
  child: Pick<ChildProcess, 'on' | 'kill'>,
  host: Pick<NodeJS.Process, 'on' | 'off'> = process,
  foreground = false
): Promise<number> {
  const forwards = STOP_SIGNALS.map((signal) => {
    const forward = () => {
      if (!foreground || signal === 'SIGTERM') child.kill(signal);
    };
    host.on(signal, forward);
    return () => host.off(signal, forward);
  });
  const stopOnExit = () => child.kill('SIGTERM');
  host.on('exit', stopOnExit);
  const release = () => {
    forwards.forEach((remove) => remove());
    host.off('exit', stopOnExit);
  };
  return new Promise((resolve) => {
    child.on('error', (error) => {
      release();
      console.error(`n10: could not start child: ${error.message}`);
      resolve(1);
    });
    child.on('close', (code, signal) => {
      release();
      resolve(exitStatus(code, signal));
    });
  });
}
