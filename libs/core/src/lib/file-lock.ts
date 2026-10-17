import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fstatSync,
  linkSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname, uptime } from 'node:os';

/**
 * Lock files several processes take in turn: the TUI, the desktop host
 * and `n10 util add-comment`.
 *
 * A lock file holds its owner's token (machine, pid, nonce), linked
 * into place already written. A process releases only a lock that still
 * holds its own token, and takes over a lock only when its owner is
 * gone, under a second `.break` lock and only if the file still holds
 * the token it judged gone, so two waiters cannot both break it.
 */

const HOST = hostname();

/** Age past which a holder that cannot be checked — on another machine,
 *  or a token naming no process — is taken to be gone. */
const UNCHECKABLE_MS = 60_000;

interface Holder {
  token: string;
  ageMs: number;
}

function code(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

function ownerToken(): string {
  return JSON.stringify({ host: HOST, pid: process.pid, id: randomUUID() });
}

/** Create `path` holding `token`, or answer false when it exists. */
function tryCreate(path: string, token: string): boolean {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, token, { mode: 0o600 });
  try {
    linkSync(tmp, path);
    return true;
  } catch (err) {
    if (code(err) === 'EEXIST') return false;
    throw err;
  } finally {
    rmSync(tmp, { force: true });
  }
}

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
    return code(err) === 'EPERM';
  }
}

/** A holder on this machine is judged by its pid alone, so a live one —
 *  stopped, or posting over a slow network — is never taken over. A
 *  lock written before this boot is gone whatever its pid now names. */
function isGone({ token, ageMs }: Holder): boolean {
  if (ageMs > uptime() * 1000) return true;
  let owner: { host?: unknown; pid?: unknown };
  try {
    owner = JSON.parse(token) as typeof owner;
  } catch {
    return ageMs > UNCHECKABLE_MS;
  }
  if (owner.host === HOST && typeof owner.pid === 'number') {
    return !isRunning(owner.pid);
  }
  return ageMs > UNCHECKABLE_MS;
}

function removeIfHeldBy(path: string, token: string): void {
  if (readHolder(path)?.token === token) rmSync(path, { force: true });
}

/** Take `path` now, breaking it first if its owner is gone. */
function tryTake(path: string, token: string): boolean {
  if (tryCreate(path, token)) return true;
  const holder = readHolder(path);
  if (!holder || !isGone(holder)) return false;
  breakLock(path, holder.token);
  return tryCreate(path, token);
}

/** Remove `path` if it still holds `gone`, under `path.break` so only
 *  one waiter breaks it. A breaker that died leaves `.break` to the
 *  next waiter to clear, never to take. */
function breakLock(path: string, gone: string): void {
  const breaker = `${path}.break`;
  const token = ownerToken();
  if (!tryCreate(breaker, token)) {
    const other = readHolder(breaker);
    if (other && isGone(other)) removeIfHeldBy(breaker, other.token);
    return;
  }
  try {
    removeIfHeldBy(path, gone);
  } finally {
    removeIfHeldBy(breaker, token);
  }
}

const pause = new Int32Array(new SharedArrayBuffer(4));

export class LockTimeoutError extends Error {
  constructor(readonly path: string) {
    super(`Timed out waiting for ${path}`);
    this.name = 'LockTimeoutError';
  }
}

/**
 * Run `fn` holding `path`. Synchronous throughout: `fn` does a few
 * milliseconds of file work, so a waiter blocks no longer than the
 * synchronous writes it replaces would, and nothing else in the
 * process can interleave with the section.
 */
export function withFileLock<T>(
  path: string,
  fn: () => T,
  timeoutMs = 2_000
): T {
  const token = ownerToken();
  const deadline = Date.now() + timeoutMs;
  while (!tryTake(path, token)) {
    if (Date.now() > deadline) {
      throw new LockTimeoutError(path);
    }
    Atomics.wait(pause, 0, 0, 5);
  }
  try {
    return fn();
  } finally {
    removeIfHeldBy(path, token);
  }
}

/**
 * Claim `path` for work that spans awaits, such as a publication: the
 * release, or null when a running process holds it, this one included.
 */
export function claimFile(path: string): (() => void) | null {
  const token = ownerToken();
  return tryTake(path, token) ? () => removeIfHeldBy(path, token) : null;
}

/** Whether a running process holds the claim on `path`. */
export function isClaimed(path: string): boolean {
  const holder = readHolder(path);
  return holder !== null && !isGone(holder);
}
