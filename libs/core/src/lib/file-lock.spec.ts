import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimFile, isClaimed, withFileLock } from './file-lock.js';

let dir: string;
let lock: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'n10-file-lock-'));
  lock = join(dir, 'store.lock');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A pid that named a process on this machine and no longer does. */
function deadPid(): number {
  const child = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(String(process.pid))'],
    {
      encoding: 'utf8',
    }
  );
  return Number(child.stdout);
}

function token(pid: number, host = hostname()): string {
  return JSON.stringify({ host, pid, id: 'other' });
}

describe('withFileLock', () => {
  it('holds the lock for the section and removes it after', () => {
    const seen = withFileLock(lock, () => existsSync(lock));
    expect(seen).toBe(true);
    expect(existsSync(lock)).toBe(false);
  });

  it('releases the lock when the section throws', () => {
    expect(() =>
      withFileLock(lock, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(existsSync(lock)).toBe(false);
  });

  it('waits for a live holder, then gives up', () => {
    writeFileSync(lock, token(process.pid));
    expect(() => withFileLock(lock, () => 'ran', 50)).toThrow('Timed out');
    expect(readFileSync(lock, 'utf8')).toBe(token(process.pid));
  });

  it('takes over a lock whose holder on this machine has exited', () => {
    writeFileSync(lock, token(deadPid()));
    expect(withFileLock(lock, () => 'ran', 50)).toBe('ran');
    expect(existsSync(lock)).toBe(false);
  });

  it('leaves alone a lock that is no longer its own', () => {
    // Taken over while it ran: releasing must not free the new holder.
    withFileLock(lock, () => writeFileSync(lock, token(process.pid)));
    expect(readFileSync(lock, 'utf8')).toBe(token(process.pid));
  });

  it('judges a holder on another machine by age alone', () => {
    writeFileSync(lock, token(deadPid(), 'elsewhere'));
    expect(() => withFileLock(lock, () => 'ran', 50)).toThrow('Timed out');
  });
});

describe('claimFile', () => {
  it('lets one holder at a time claim, this process included', () => {
    const release = claimFile(lock);
    expect(release).not.toBeNull();
    expect(isClaimed(lock)).toBe(true);
    expect(claimFile(lock)).toBeNull();
    release?.();
    expect(isClaimed(lock)).toBe(false);
    expect(claimFile(lock)).not.toBeNull();
  });

  it('treats a claim whose holder exited as free', () => {
    writeFileSync(lock, token(deadPid()));
    expect(isClaimed(lock)).toBe(false);
    expect(claimFile(lock)).not.toBeNull();
  });
});
