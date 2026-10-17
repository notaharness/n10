import type { ChildProcess } from 'node:child_process';

type Host = Pick<NodeJS.Process, 'on' | 'off'>;
type Input = Pick<NodeJS.ReadStream, 'isTTY' | 'on' | 'off' | 'pause'> &
  Partial<Pick<NodeJS.ReadStream, 'setRawMode' | 'resume'>>;

/** npm shares the foreground group. Keep its parent (possibly the session
 * leader) alive through npm rollback, result persistence and lock release.
 * On a tty, n10 reads Ctrl-C itself: the first asks npm to cancel and later
 * ones are ignored, since a second SIGINT kills npm mid-rollback. A tty hangup
 * still reaches npm directly. TERM sent to the parent is forwarded. */
export function protectNpmTransaction(
  onCancel: () => void = () => undefined,
  host: Host = process,
  input: Input = process.stdin
) {
  let child: Pick<ChildProcess, 'kill'> | undefined;
  let cancelled = false;
  let settled = false;
  const raw = input.isTTY === true && typeof input.setRawMode === 'function';
  const absorb = () => undefined;
  const terminate = () => child?.kill('SIGTERM');
  const cancel = () => {
    if (cancelled || settled) return;
    cancelled = true;
    child?.kill('SIGINT');
    onCancel();
  };
  const read = (chunk: Buffer | string) => {
    if (String(chunk).includes('\x03')) cancel();
  };
  // Raw mode turns off the tty's ISIG, so a SIGINT here came from elsewhere.
  const interrupt = raw ? cancel : absorb;
  host.on('SIGINT', interrupt);
  host.on('SIGHUP', absorb);
  host.on('SIGTERM', terminate);
  if (raw) {
    input.setRawMode?.(true);
    input.on('data', read);
    input.resume?.();
  }
  return {
    watch(value: ChildProcess) {
      child = value;
      value.once('close', () => (settled = true));
      if (cancelled) value.kill('SIGINT');
    },
    dispose() {
      host.off('SIGINT', interrupt);
      host.off('SIGHUP', absorb);
      host.off('SIGTERM', terminate);
      if (!raw) return;
      input.off('data', read);
      input.pause();
      try {
        input.setRawMode?.(false);
      } catch {
        // A hung-up tty rejects mode changes; there is no terminal to restore.
      }
    },
  };
}
