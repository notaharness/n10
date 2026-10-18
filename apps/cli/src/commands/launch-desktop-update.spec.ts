import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { launchDesktop } from './launch-desktop.js';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  // The sandbox probe: no user namespaces, as on most CI runners.
  spawnSync: vi.fn().mockReturnValue({ status: 1 }),
  runNpmUpdate: vi
    .fn()
    .mockResolvedValue({ status: 'succeeded', message: 'Updated' }),
  relaunchNpmApp: vi.fn().mockResolvedValue(23),
  showNpmUpdateCancelling: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
  spawnSync: mocks.spawnSync,
}));
vi.mock('node:module', () => ({
  createRequire: () => () => '/fixture/electron',
}));
vi.mock('./desktop-update-runtime.js', () => mocks);
let home: string;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  rmSync(home, { recursive: true, force: true });
});

it('passes the private request to Electron and finishes the update only after exit 42', async () => {
  home = mkdtempSync(join(tmpdir(), 'n10-launcher-wiring-'));
  const root = join(home, 'package');
  mkdirSync(join(root, 'desktop/main'), { recursive: true });
  writeFileSync(join(root, 'desktop/main/main.js'), '');
  vi.stubEnv('HOME', home);
  // A display to launch on, which unit-test runners do not have.
  vi.stubEnv('DISPLAY', ':0');
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  const finished = launchDesktop(root, '1.0.0-beta.1');
  const [executable, args, options] = mocks.spawn.mock.calls[0];
  expect(executable).toBe('/fixture/electron');
  expect(args).toContain(root);
  const request = options.env.N10_UPDATE_HANDOFF as string;
  expect(request).toContain(join(home, '.n10/update-handoff-'));
  const plan = {
    root,
    prefix: home,
    version: '1.0.0-beta.2',
    fromVersion: '1.0.0-beta.1',
  };
  writeFileSync(request, JSON.stringify(plan));
  expect(mocks.runNpmUpdate).not.toHaveBeenCalled();
  child.emit('close', 42, null);
  await expect(finished).resolves.toBe(23);
  expect(mocks.runNpmUpdate).toHaveBeenCalledWith(plan, {
    onCancel: expect.any(Function),
  });
  expect(mocks.relaunchNpmApp).toHaveBeenCalledWith(root, 'desktop');
  expect(existsSync(dirname(request))).toBe(false);
});
