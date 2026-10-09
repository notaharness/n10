import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { relaunchNpmApp } from './relaunch-npm-app.js';
import { superviseChild } from './child-supervision.js';
const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

it('starts the installed entry in the foreground and maps its signal exit', async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  spawn.mockReturnValue(child);
  vi.stubEnv('N10_UPDATE_HANDOFF', '/stale/request');
  try {
    const exit = relaunchNpmApp('/installed', 'tui');
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['/installed/main.js', '--tui', process.cwd()],
      {
        stdio: 'inherit',
        env: expect.not.objectContaining({
          N10_UPDATE_HANDOFF: expect.anything(),
        }),
      }
    );
    child.emit('close', null, 'SIGTERM');
    await expect(exit).resolves.toBe(143);
  } finally {
    vi.unstubAllEnvs();
  }
});

it('absorbs foreground tty signals, forwards TERM and waits for the child', async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const host = new EventEmitter();
  const status = superviseChild(child as never, host as never, true);
  host.emit('SIGINT');
  host.emit('SIGHUP');
  expect(child.kill).not.toHaveBeenCalled();
  host.emit('SIGTERM');
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
  child.emit('close', null, 'SIGHUP');
  await expect(status).resolves.toBe(129);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'exit'])
    expect(host.listenerCount(signal)).toBe(0);
});
