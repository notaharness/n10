import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOCK_FILE,
  STOP_WAIT_MS,
  takeHostLock,
  type HostLockDeps,
} from './host-lock.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function dir() {
  const d = mkdtempSync(join(tmpdir(), 'n10-lock-'));
  made.push(d);
  return d;
}

/** Processes by pid: running, an n10 host or not, and whether one
 *  stops on SIGTERM. */
function machine() {
  const procs = new Map<number, { host: boolean; stubborn?: boolean }>();
  const signals: [number, NodeJS.Signals][] = [];
  const deps = (pid: number): HostLockDeps => ({
    pid,
    alive: (p) => procs.has(p),
    isHost: (p) => procs.get(p)?.host ?? false,
    signal: (p, signal) => {
      signals.push([p, signal]);
      if (signal === 'SIGKILL' || !procs.get(p)?.stubborn) procs.delete(p);
    },
    sleep: async () => undefined,
  });
  return { procs, signals, deps };
}

describe('takeHostLock', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  it('takes over from the host before it, which then knows it was replaced', async () => {
    const d = dir();
    const m = machine();
    m.procs.set(1, { host: true });
    const first = await takeHostLock(d, m.deps(1));
    m.procs.set(2, { host: true });
    const second = await takeHostLock(d, m.deps(2));
    expect(m.signals).toEqual([[1, 'SIGTERM']]);
    expect(first.replaced()).toBe(true);
    expect(second.replaced()).toBe(false);
    // The old host's release leaves the new one's lock.
    first.release();
    expect(JSON.parse(readFileSync(join(d, LOCK_FILE), 'utf8')).pid).toBe(2);
    second.release();
    expect(() => readFileSync(join(d, LOCK_FILE))).toThrow();
  });

  it('kills a host too stuck to stop', async () => {
    const d = dir();
    const m = machine();
    m.procs.set(1, { host: true, stubborn: true });
    await takeHostLock(d, m.deps(1));
    const sleep = vi.fn(async () => undefined);
    await takeHostLock(d, { ...m.deps(2), sleep });
    expect(m.signals).toEqual([
      [1, 'SIGTERM'],
      [1, 'SIGKILL'],
    ]);
    expect(sleep.mock.calls.length).toBeGreaterThanOrEqual(STOP_WAIT_MS / 100);
  });

  it('leaves alone a process that took a gone host’s id', async () => {
    const d = dir();
    const m = machine();
    await takeHostLock(d, m.deps(1));
    m.procs.set(1, { host: false });
    await takeHostLock(d, m.deps(2));
    expect(m.signals).toEqual([]);
  });
});
