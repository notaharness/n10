import type { ChildProcess } from 'node:child_process';

/** npm shares the foreground group and gets the tty's INT/HUP itself.
 * Keep its parent (possibly the session leader) alive through npm rollback,
 * result persistence and lock release. TERM sent to the parent is forwarded. */
export function protectNpmTransaction() {
  let child: ChildProcess | undefined;
  const absorb = () => undefined;
  const terminate = () => child?.kill('SIGTERM');
  process.on('SIGINT', absorb);
  process.on('SIGHUP', absorb);
  process.on('SIGTERM', terminate);
  return {
    watch(value: ChildProcess) {
      child = value;
    },
    dispose() {
      process.off('SIGINT', absorb);
      process.off('SIGHUP', absorb);
      process.off('SIGTERM', terminate);
    },
  };
}
