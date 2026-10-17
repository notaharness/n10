import type { ChildProcess } from 'node:child_process';

type Host = Pick<NodeJS.Process, 'on' | 'off'>;
type Input = Pick<NodeJS.ReadStream, 'isTTY' | 'on' | 'off' | 'pause'> &
  Partial<Pick<NodeJS.ReadStream, 'setRawMode' | 'resume'>>;

/** Raw mode when stdin is a tty that accepts it; otherwise stay cooked. */
function holdRawMode(input: Input): boolean {
  if (input.isTTY !== true || typeof input.setRawMode !== 'function')
    return false;
  try {
    input.setRawMode(true);
    return true;
  } catch {
    return false;
  }
}

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
  const raw = holdRawMode(input);
  const absorb = () => undefined;
  const terminate = () => child?.kill('SIGTERM');
  const cancel = () => {
    if (cancelled || settled) return;
    cancelled = true;
    child?.kill('SIGINT');
    try {
      onCancel();
    } catch (error) {
      // Throwing here would end n10 mid-rollback and orphan npm.
      console.error(
        'n10:',
        error instanceof Error ? error.message : String(error)
      );
    }
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
    // A hung-up tty reports EIO on read; npm still gets the hangup itself.
    input.on('error', absorb);
    input.on('data', read);
    input.resume?.();
  }
  return {
    watch(value: ChildProcess) {
      child = value;
      const settle = () => (settled = true);
      value.once('close', settle);
      value.once('error', settle);
      if (cancelled) value.kill('SIGINT');
    },
    dispose() {
      host.off('SIGINT', interrupt);
      host.off('SIGHUP', absorb);
      host.off('SIGTERM', terminate);
      if (!raw) return;
      input.off('data', read);
      input.off('error', absorb);
      input.pause();
      try {
        input.setRawMode?.(false);
      } catch {
        // A hung-up tty rejects mode changes; there is no terminal to restore.
      }
    },
  };
}
