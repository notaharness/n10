import {
  closeSync,
  fstatSync,
  linkSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * A lock file several processes can take in turn, for critical sections
 * of a few milliseconds.
 *
 * The file holds its owner's token: the machine, the process and a
 * nonce. That is what makes the two dangerous moves safe. Releasing
 * removes the file only if it still holds this owner's token, so a
 * writer never deletes a lock someone else now holds. Taking over from
 * a writer that died holding it happens only when that writer is shown
 * to be gone — its process no longer exists — and only under a second
 * lock, re-checking that the file still holds the dead writer's token,
 * so two waiters cannot both break it and both get in.
 */

export interface LockTiming {
  /** How long to wait for a live holder before giving up. */
  timeoutMs: number;
  /**
   * Age after which a holder that cannot be checked — on another
   * machine, or whose pid may since have been reused — is taken to be
   * gone. Far longer than any critical section, so a live holder is
   * only ever overtaken this way after being suspended for that long.
   */
  abandonedMs: number;
  retryMs: number;
}

const DEFAULT_TIMING: LockTiming = {
  timeoutMs: 10_000,
  abandonedMs: 60_000,
  retryMs: 5,
};

const HOST = hostname();

interface Owner {
  host: string;
  pid: number;
}

interface Holder {
  token: string;
  ageMs: number;
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

/** A token naming this process: its machine, its pid and a nonce. */
export function ownerToken(): string {
  return JSON.stringify({ host: HOST, pid: process.pid, id: randomUUID() });
}

function ownerOf(token: string): Owner | null {
  try {
    const parsed = JSON.parse(token) as Partial<Owner>;
    return typeof parsed.host === 'string' && typeof parsed.pid === 'number'
      ? { host: parsed.host, pid: parsed.pid }
      : null;
  } catch {
    return null;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Create `path` holding `token`, or answer false when it exists. The
 * token is written first and the finished file linked into place, so
 * the lock never exists without it.
 */
function tryCreate(path: string, token: string): boolean {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, token, 'utf8');
  try {
    linkSync(tmp, path);
    return true;
  } catch (err) {
    if (errorCode(err) === 'EEXIST') return false;
    throw err;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Who holds `path` and for how long, read from one open file. */
function readHolder(path: string): Holder | null {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    const ageMs = Date.now() - fstatSync(fd).mtimeMs;
    return { token: readFileSync(fd, 'utf8'), ageMs };
  } finally {
    closeSync(fd);
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return errorCode(err) === 'EPERM';
  }
}

/**
 * Whether the process `token` names is gone: shown dead on this machine,
 * or — when that cannot be checked, or its pid may since have been
 * reused — older than `abandonedMs`.
 */
export function isOwnerGone(
  token: string,
  ageMs: number,
  abandonedMs: number
): boolean {
  return ageMs > abandonedMs || ownerAlive(token) === false;
}

/**
 * Whether the process `token` names is running, or undefined when that
 * cannot be checked: it is on another machine, or the token names none.
 */
export function ownerAlive(token: string): boolean | undefined {
  const owner = ownerOf(token);
  return owner?.host === HOST ? isRunning(owner.pid) : undefined;
}

function isAbandoned(holder: Holder, timing: LockTiming): boolean {
  return isOwnerGone(holder.token, holder.ageMs, timing.abandonedMs);
}

function removeIfHeldBy(path: string, token: string): void {
  if (readHolder(path)?.token === token) rmSync(path, { force: true });
}

/**
 * Remove `lockPath` if it still holds `abandoned`, under a second lock
 * so only one waiter breaks it. Returns without breaking anything when
 * another waiter is already doing so.
 */
export function breakAbandonedLock(
  lockPath: string,
  abandoned: string,
  timing: LockTiming = DEFAULT_TIMING
): void {
  const breaker = `${lockPath}.break`;
  const token = ownerToken();
  if (!tryCreate(breaker, token)) {
    const other = readHolder(breaker);
    if (other && isAbandoned(other, timing)) {
      removeIfHeldBy(breaker, other.token);
    }
    return;
  }
  try {
    removeIfHeldBy(lockPath, abandoned);
  } finally {
    removeIfHeldBy(breaker, token);
  }
}

/** Run `fn` holding `lockPath`. */
export function withFileLock<T>(
  lockPath: string,
  fn: () => T,
  timing: LockTiming = DEFAULT_TIMING
): T {
  const token = ownerToken();
  const deadline = Date.now() + timing.timeoutMs;
  while (!tryCreate(lockPath, token)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${lockPath}`);
    }
    const holder = readHolder(lockPath);
    if (holder && isAbandoned(holder, timing)) {
      breakAbandonedLock(lockPath, holder.token, timing);
    }
    sleepSync(timing.retryMs);
  }
  try {
    return fn();
  } finally {
    removeIfHeldBy(lockPath, token);
  }
}
