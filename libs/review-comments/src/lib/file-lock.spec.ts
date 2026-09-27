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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-file-lock-'));
  lock = join(dir, 'comments.json.lock');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('withFileLock', () => {
  it('holds the lock for the section and leaves nothing behind', () => {
    const seen = withFileLock(lock, () => {
      const holder = JSON.parse(readFileSync(lock, 'utf8')) as {
        pid: number;
      };
      return holder.pid;
    });
    expect(seen).toBe(process.pid);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('releases the lock when the section throws', () => {
    expect(() =>
      withFileLock(lock, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('takes over from a holder whose process has exited', () => {
    writeFileSync(lock, tokenOf(deadPid()));
    expect(withFileLock(lock, () => 'in', quick)).toBe('in');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('takes over from a holder it cannot check once the lock is old', () => {
    // A lock from another machine, or one with no readable owner.
    writeFileSync(lock, JSON.stringify({ host: 'elsewhere', pid: 1 }));
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    expect(withFileLock(lock, () => 'in', quick)).toBe('in');
  });

  /** A holder that is alive but slow — suspended, stopped with Ctrl+Z,
   *  on a stalled disk — is still in its section. Breaking its lock
   *  would let a second writer in beside it. */
  it('waits for a live holder rather than overtaking it', () => {
    writeFileSync(lock, tokenOf(process.ppid));
    const old = new Date(Date.now() - 30_000);
    utimesSync(lock, old, old);
    expect(() => withFileLock(lock, () => 'in', quick)).toThrow(
      'Timed out waiting'
    );
    expect(readFileSync(lock, 'utf8')).toBe(tokenOf(process.ppid));
  });

  it('does not release a lock that is no longer its own', () => {
    withFileLock(lock, () => {
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
  it('leaves a lock that no longer holds the abandoned token', () => {
    const abandoned = tokenOf(deadPid(), 'dead');
    const successor = tokenOf(process.ppid, 'successor');
    writeFileSync(lock, successor);
    breakAbandonedLock(lock, abandoned, quick);
    expect(readFileSync(lock, 'utf8')).toBe(successor);
  });

  it('removes the lock that still holds it', () => {
    const abandoned = tokenOf(deadPid(), 'dead');
    writeFileSync(lock, abandoned);
    breakAbandonedLock(lock, abandoned, quick);
    expect(existsSync(lock)).toBe(false);
  });

  it('breaks nothing while another waiter is breaking it', () => {
    const abandoned = tokenOf(deadPid(), 'dead');
    writeFileSync(lock, abandoned);
    writeFileSync(`${lock}.break`, tokenOf(process.ppid, 'breaker'));
    breakAbandonedLock(lock, abandoned, quick);
    expect(readFileSync(lock, 'utf8')).toBe(abandoned);
  });
});
