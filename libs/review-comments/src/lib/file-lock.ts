import { link, open, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

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
 *
 * Waiting is on timers, never by blocking: the processes that take this
 * lock are the TUI and the desktop host, whose one thread draws the UI
 * and answers everything else while a writer holds it.
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

function newToken(): string {
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

/**
 * Create `path` holding `token`, or answer false when it exists. The
 * token is written first and the finished file linked into place, so
 * the lock never exists without it.
 */
async function tryCreate(path: string, token: string): Promise<boolean> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, token, 'utf8');
  try {
    await link(tmp, path);
    return true;
  } catch (err) {
    if (errorCode(err) === 'EEXIST') return false;
    throw err;
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Who holds `path` and for how long, read from one open file. */
async function readHolder(path: string): Promise<Holder | null> {
  let file: FileHandle;
  try {
    file = await open(path, 'r');
  } catch {
    return null;
  }
  try {
    const ageMs = Date.now() - (await file.stat()).mtimeMs;
    return { token: await file.readFile('utf8'), ageMs };
  } finally {
    await file.close();
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

function isAbandoned(holder: Holder, timing: LockTiming): boolean {
  if (holder.ageMs > timing.abandonedMs) return true;
  const owner = ownerOf(holder.token);
  return owner?.host === HOST && !isRunning(owner.pid);
}

async function removeIfHeldBy(path: string, token: string): Promise<void> {
  if ((await readHolder(path))?.token === token) {
    await rm(path, { force: true });
  }
}

/**
 * Remove `lockPath` if it still holds `abandoned`, under a second lock
 * so only one waiter breaks it. Returns without breaking anything when
 * another waiter is already doing so.
 */
export async function breakAbandonedLock(
  lockPath: string,
  abandoned: string,
  timing: LockTiming = DEFAULT_TIMING
): Promise<void> {
  const breaker = `${lockPath}.break`;
  const token = newToken();
  if (!(await tryCreate(breaker, token))) {
    const other = await readHolder(breaker);
    if (other && isAbandoned(other, timing)) {
      await removeIfHeldBy(breaker, other.token);
    }
    return;
  }
  try {
    await removeIfHeldBy(lockPath, abandoned);
  } finally {
    await removeIfHeldBy(breaker, token);
  }
}

/**
 * Run `fn` holding `lockPath`. Each call is its own holder, so two in
 * one process wait for each other as two processes would.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T> | T,
  timing: LockTiming = DEFAULT_TIMING
): Promise<T> {
  const token = newToken();
  const deadline = Date.now() + timing.timeoutMs;
  while (!(await tryCreate(lockPath, token))) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${lockPath}`);
    }
    const holder = await readHolder(lockPath);
    if (holder && isAbandoned(holder, timing)) {
      await breakAbandonedLock(lockPath, holder.token, timing);
    }
    await sleep(timing.retryMs);
  }
  try {
    return await fn();
  } finally {
    await removeIfHeldBy(lockPath, token);
  }
}
