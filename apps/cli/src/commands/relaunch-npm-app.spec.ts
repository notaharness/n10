import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { relaunchNpmApp } from './relaunch-npm-app.js';
const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));
let root: string;
beforeEach(() => {
  spawn.mockReset();
  root = mkdtempSync(join(tmpdir(), 'n10-relaunch-test-'));
  writeFileSync(join(root, 'main.js'), '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it.each(['tui', 'desktop'] as const)(
  'supervises the actual %s relaunch in the foreground',
  async (mode) => {
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    spawn.mockReturnValue(child);
    vi.stubEnv('N10_UPDATE_HANDOFF', '/stale/request');
    const signals = ['SIGINT', 'SIGHUP', 'SIGTERM'] as const;
    const before = new Map(
      signals.map((signal) => [signal, process.listeners(signal)])
    );
    const exit = relaunchNpmApp(root, mode);
    try {
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [
          join(root, 'main.js'),
          ...(mode === 'tui' ? ['--tui', process.cwd()] : []),
        ],
        {
          stdio: 'inherit',
          env: expect.not.objectContaining({
            N10_UPDATE_HANDOFF: expect.anything(),
          }),
        }
      );
      for (const signal of signals) {
        // Exercise only the handlers this relaunch installed, not Vitest's own.
        const handlers = process
          .listeners(signal)
          .filter((listener) => !before.get(signal)!.includes(listener));
        expect(handlers).toHaveLength(1);
        handlers[0].call(process, signal);
        expect(child.kill).toHaveBeenCalledTimes(Number(signal === 'SIGTERM'));
      }
      expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    } finally {
      child.emit('close', null, 'SIGTERM');
      await expect(exit).resolves.toBe(143);
      for (const signal of signals)
        expect(process.listeners(signal)).toEqual(before.get(signal));
    }
  }
);

it.each(['tui', 'desktop'] as const)(
  'does not spawn Node when the %s entry is missing',
  async (mode) => {
    unlinkSync(join(root, 'main.js'));
    await expect(relaunchNpmApp(root, mode)).rejects.toThrow(
      'installation is incomplete'
    );
    expect(spawn).not.toHaveBeenCalled();
  }
);
