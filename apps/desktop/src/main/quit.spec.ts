import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostProcess } from './host-process.js';

const app = vi.hoisted(() => ({
  on: vi.fn<
    (
      name: string,
      handler: (event: { preventDefault: () => void }) => void
    ) => void
  >(),
  quit: vi.fn(),
  exit: vi.fn(),
  releaseSingleInstanceLock: vi.fn(),
}));
vi.mock('electron', () => ({ app }));
let dir: string;
let request: string;
const plan = {
  root: '/test/n10',
  prefix: '/test',
  version: '1.0.0-beta.2',
  fromVersion: '1.0.0-beta.1',
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'n10-quit-update-'));
  request = join(dir, 'request.json');
  vi.stubEnv('N10_UPDATE_HANDOFF', request);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
function willQuit() {
  const handler = app.on.mock.calls.find(([name]) => name === 'will-quit')![1];
  handler({ preventDefault: vi.fn() });
}

describe('npm update quit handoff', () => {
  it('writes only after quit is accepted and waits for the host before exiting with the update code', async () => {
    const { installQuitHandler, quitForNpmUpdate } = await import('./quit.js');
    let stopped!: () => void;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          stopped = resolve;
        })
    );
    installQuitHandler(() => ({ stop } as unknown as HostProcess));
    await quitForNpmUpdate(plan);
    expect(existsSync(request)).toBe(false);
    willQuit();
    expect(JSON.parse(readFileSync(request, 'utf8'))).toEqual(plan);
    expect(stop).toHaveBeenCalledOnce();
    expect(app.exit).not.toHaveBeenCalled();
    stopped();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(42));
  });

  it('clears a cancelled update so a later ordinary quit cannot install it', async () => {
    const { installQuitHandler, quitForNpmUpdate, cancelUpdateQuit } =
      await import('./quit.js');
    installQuitHandler(() => null);
    await quitForNpmUpdate(plan);
    cancelUpdateQuit();
    willQuit();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0));
    expect(existsSync(request)).toBe(false);
  });

  it('does not authorize installation if the host fails to stop', async () => {
    const { installQuitHandler, quitForNpmUpdate } = await import('./quit.js');
    const stop = vi.fn().mockRejectedValue(new Error('shutdown failed'));
    installQuitHandler(() => ({ stop } as unknown as HostProcess));
    await quitForNpmUpdate(plan);
    willQuit();
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(1));
    expect(app.exit).not.toHaveBeenCalledWith(42);
  });
});
