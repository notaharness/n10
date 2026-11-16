/**
 * One session host behind a pipe per user on a machine. Two would both
 * run discovery, sync loops and auto-fixers for the same pull requests,
 * and each its own beam daemon. A frontend whose connection dropped
 * starts a new host before the old one has noticed (sshd may not for
 * hours, and a host blocked writing to a full pipe never does), so the
 * new host takes over: it writes the lock, then stops the host the lock
 * named, by SIGTERM and then SIGKILL. The old host reads the lock as it
 * stops and tells its frontend it was replaced, which then does not
 * start it again (`host-process.ts`).
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'host.lock';
/** How long a host has to stop by itself: it detaches its terminals
 *  and stops its beam daemon first. */
export const STOP_WAIT_MS = 8000;
const KILL_WAIT_MS = 2000;
const POLL_MS = 100;

interface LockRecord {
  pid: number;
  token: string;
}

export interface HostLockDeps {
  pid: number;
  alive(pid: number): boolean;
  /** `pid` is an n10 host, not a process that took a dead host's id. */
  isHost(pid: number): boolean;
  signal(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<void>;
}

export interface HostLock {
  /** A later host has taken the lock. */
  replaced(): boolean;
  /** Removes the lock, if it is still this host's. */
  release(): void;
}

export async function takeHostLock(
  dir: string,
  deps: HostLockDeps = systemDeps()
): Promise<HostLock> {
  const file = join(dir, LOCK_FILE);
  const previous = readLock(file);
  const token = randomUUID();
  mkdirSync(dir, { recursive: true });
  // Written first: the host stopped reads it to learn why.
  writeFileSync(file, JSON.stringify({ pid: deps.pid, token }));
  if (
    previous &&
    previous.pid !== deps.pid &&
    deps.alive(previous.pid) &&
    deps.isHost(previous.pid)
  ) {
    await stop(previous.pid, deps);
  }
  const ours = () => readLock(file)?.token === token;
  return {
    replaced: () => !ours(),
    release: () => {
      if (ours()) rmSync(file, { force: true });
    },
  };
}

async function stop(pid: number, deps: HostLockDeps): Promise<void> {
  console.error(`[host] taking over from host ${pid}`);
  deps.signal(pid, 'SIGTERM');
  if (await exits(pid, STOP_WAIT_MS, deps)) return;
  console.error(`[host] host ${pid} did not stop; killing it`);
  deps.signal(pid, 'SIGKILL');
  await exits(pid, KILL_WAIT_MS, deps);
}

async function exits(
  pid: number,
  ms: number,
  deps: HostLockDeps
): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += POLL_MS) {
    if (!deps.alive(pid)) return true;
    await deps.sleep(POLL_MS);
  }
  return !deps.alive(pid);
}

function readLock(file: string): LockRecord | null {
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as LockRecord;
    return Number.isInteger(record.pid) && typeof record.token === 'string'
      ? record
      : null;
  } catch {
    return null;
  }
}

function systemDeps(): HostLockDeps {
  return {
    pid: process.pid,
    alive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
      }
    },
    isHost: (pid) => {
      try {
        const args = execFileSync('ps', ['-o', 'args=', '-p', String(pid)], {
          encoding: 'utf8',
        });
        return / host --stdio/.test(args);
      } catch {
        return false;
      }
    },
    signal: (pid, signal) => {
      try {
        process.kill(pid, signal);
      } catch {
        // it went by itself
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
