import { closeSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as Koffi from 'koffi';
import type { MuxRuntime } from './mux-endpoint.js';
import { MuxError } from './mux-error.js';

/**
 * The POSIX runtime directory's startup lock: `flock(2)` on
 * `startup.lock`, which the kernel releases when its holder exits, so
 * a crash cannot leave it held. Node has no file-lock API; the call
 * goes through koffi, loaded only here. Only removing a dead owner's
 * socket needs it (`mux-ipc.ts`), so a normal start never loads it.
 */
export interface RuntimeLock {
  release(): void;
}

const LOCK_EX = 2;
const LOCK_NB = 4;
const POLL_MS = 20;
const WAIT_MS = 10_000;

type Flock = (fd: number, operation: number) => number;

let flock: Flock | undefined;

/** `flock` that answers -1 only for a lock held elsewhere. */
function loadFlock(endpoint: string): Flock {
  if (flock) return flock;
  let koffi: typeof Koffi;
  let call: Flock;
  try {
    koffi = createRequire(import.meta.url)('koffi') as typeof Koffi;
    const libc = koffi.load(
      process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6'
    );
    call = libc.func('int flock(int fd, int operation)') as Flock;
  } catch (err) {
    // No koffi, or a libc it cannot load (musl has no libc.so.6).
    throw new MuxError(
      'UNSUPPORTED',
      `A previous n10 mux owner left ${endpoint} behind, and without ` +
        'file locking n10 cannot remove it safely ' +
        `(${err instanceof Error ? err.message : String(err)}). ` +
        `Delete ${endpoint} and start again.`
    );
  }
  flock = (fd, operation) => {
    const result = call(fd, operation);
    if (result !== 0 && koffi.errno() !== koffi.os.errno.EWOULDBLOCK)
      throw new Error(`flock failed (errno ${koffi.errno()})`);
    return result;
  };
  return flock;
}

/** Hold the runtime directory's startup lock, waiting for another
 *  holder to let go. */
export async function lockRuntime(runtime: MuxRuntime): Promise<RuntimeLock> {
  const call = loadFlock(runtime.endpoint);
  const fd = openSync(join(runtime.dir, 'startup.lock'), 'a', 0o600);
  const deadline = Date.now() + WAIT_MS;
  while (call(fd, LOCK_EX | LOCK_NB) !== 0) {
    if (Date.now() > deadline) {
      closeSync(fd);
      throw new MuxError(
        'UNSUPPORTED',
        `Another n10 held ${join(runtime.dir, 'startup.lock')} for too long`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  // Closing the descriptor releases the lock.
  return { release: () => closeSync(fd) };
}
