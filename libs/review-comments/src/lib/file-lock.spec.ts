import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { breakAbandonedLock, withFileLock } from './file-lock.js';

/**
 * The lock the drafts store holds around each read-modify-write.
 *
 * What these pin down is what goes wrong when a lock outlives its
 * holder: taking it over has to happen exactly once, only from a holder
 * that is gone, and a holder must never release a lock that is no
 * longer its own. Each of those, broken, lets two writers into the
 * critical section, and one of their writes is lost without a word.
 */

let dir: string;
let lock: string;

/** A token as another holder on this machine would have written it. */
const tokenOf = (pid: number, id = 'other') =>
  JSON.stringify({ host: hostname(), pid, id });

/** A process that existed and has exited. */
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

const quick = { timeoutMs: 50, abandonedMs: 60_000, retryMs: 1 };

async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!done() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-file-lock-'));
  lock = join(dir, 'comments.json.lock');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('withFileLock', () => {
  it('holds the lock for the section and leaves nothing behind', async () => {
    const seen = await withFileLock(lock, () => {
      const holder = JSON.parse(readFileSync(lock, 'utf8')) as {
        pid: number;
      };
      return holder.pid;
    });
    expect(seen).toBe(process.pid);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('releases the lock when the section throws', async () => {
    await expect(
      withFileLock(lock, () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('takes over from a holder whose process has exited', async () => {
    writeFileSync(lock, tokenOf(deadPid()));
    expect(await withFileLock(lock, () => 'in', quick)).toBe('in');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('takes over from a holder it cannot check once the lock is old', async () => {
    // A lock from another machine, or one with no readable owner.
    writeFileSync(lock, JSON.stringify({ host: 'elsewhere', pid: 1 }));
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    expect(await withFileLock(lock, () => 'in', quick)).toBe('in');
  });

  /** A holder that is alive but slow — suspended, stopped with Ctrl+Z,
   *  on a stalled disk — is still in its section. Breaking its lock
   *  would let a second writer in beside it. */
  it('waits for a live holder rather than overtaking it', async () => {
    writeFileSync(lock, tokenOf(process.ppid));
    const old = new Date(Date.now() - 30_000);
    utimesSync(lock, old, old);
    await expect(withFileLock(lock, () => 'in', quick)).rejects.toThrow(
      'Timed out waiting'
    );
    expect(readFileSync(lock, 'utf8')).toBe(tokenOf(process.ppid));
  });

  /** The holder may be this same process: the desktop host answers
   *  two edits to one PR at once, and each is its own holder. */
  it('makes a second holder in the same process wait its turn', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = withFileLock(lock, async () => {
      order.push('first in');
      await new Promise<void>((r) => (release = r));
      order.push('first out');
    });
    await until(() => order.length > 0);
    const second = withFileLock(lock, () => order.push('second in'), {
      ...quick,
      timeoutMs: 2_000,
    });
    await new Promise((r) => setTimeout(r, 30));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first in', 'first out', 'second in']);
  });

  it('does not block the thread while it waits', async () => {
    writeFileSync(lock, tokenOf(process.ppid));
    let settled = false;
    const attempt = withFileLock(lock, () => 'in', {
      ...quick,
      timeoutMs: 200,
    })
      .catch((err: unknown) => err)
      .finally(() => (settled = true));
    // A timer due long before the wait gives up fires while it waits.
    const firedWhileWaiting = await new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(!settled), 20)
    );
    expect(firedWhileWaiting).toBe(true);
    expect(await attempt).toBeInstanceOf(Error);
  });

  it('does not release a lock that is no longer its own', async () => {
    await withFileLock(lock, () => {
      // Taken over while this holder was in its section.
      writeFileSync(lock, tokenOf(process.ppid, 'successor'));
    });
    expect(readFileSync(lock, 'utf8')).toBe(tokenOf(process.ppid, 'successor'));
  });
});

/**
 * Two waiters can both see the same dead holder. The first breaks its
 * lock and takes a new one; the second must then find that new lock and
 * leave it alone, or both are inside the section at once.
 */
describe('breakAbandonedLock', () => {
  it('leaves a lock that no longer holds the abandoned token', async () => {
    const abandoned = tokenOf(deadPid(), 'dead');
    const successor = tokenOf(process.ppid, 'successor');
    writeFileSync(lock, successor);
    await breakAbandonedLock(lock, abandoned, quick);
    expect(readFileSync(lock, 'utf8')).toBe(successor);
  });

  it('removes the lock that still holds it', async () => {
    const abandoned = tokenOf(deadPid(), 'dead');
    writeFileSync(lock, abandoned);
    await breakAbandonedLock(lock, abandoned, quick);
    expect(existsSync(lock)).toBe(false);
  });

  it('breaks nothing while another waiter is breaking it', async () => {
    const abandoned = tokenOf(deadPid(), 'dead');
    writeFileSync(lock, abandoned);
    writeFileSync(`${lock}.break`, tokenOf(process.ppid, 'breaker'));
    await breakAbandonedLock(lock, abandoned, quick);
    expect(readFileSync(lock, 'utf8')).toBe(abandoned);
  });
});
