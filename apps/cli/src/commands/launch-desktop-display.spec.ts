import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { launchDesktop } from './launch-desktop.js';

const mocks = vi.hoisted(() => ({
  requireElectron: vi.fn(() => '/fixture/electron'),
  spawn: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
  spawnSync: vi.fn(),
}));
vi.mock('node:module', () => ({
  createRequire: () => mocks.requireElectron,
}));
let home: string;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

it.runIf(process.platform === 'linux')(
  'stops before loading Electron when there is no display',
  async () => {
    home = mkdtempSync(join(tmpdir(), 'n10-launcher-display-'));
    mkdirSync(join(home, 'desktop/main'), { recursive: true });
    writeFileSync(join(home, 'desktop/main/main.js'), '');
    vi.stubEnv('DISPLAY', '');
    vi.stubEnv('WAYLAND_DISPLAY', '');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await expect(launchDesktop(home, '1.0.0')).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('n10 --tui'));
    expect(mocks.requireElectron).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  }
);
