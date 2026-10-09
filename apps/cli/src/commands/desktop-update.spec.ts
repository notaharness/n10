import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopUpdateHandoff } from './desktop-update.js';

const runtime = vi.hoisted(() => ({
  runNpmUpdate: vi.fn(),
  relaunchNpmApp: vi.fn(),
}));
vi.mock('./desktop-update-runtime.js', () => runtime);
let home: string;
let root: string;
beforeEach(() => {
  vi.clearAllMocks();
  home = mkdtempSync(join(tmpdir(), 'n10-desktop-update-unit-'));
  root = join(home, 'installation');
  mkdirSync(root);
  vi.stubEnv('HOME', home);
  runtime.runNpmUpdate.mockResolvedValue({
    status: 'succeeded',
    message: 'Updated',
    logPath: home,
  });
  runtime.relaunchNpmApp.mockResolvedValue(23);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('existing desktop launcher npm handoff', () => {
  it('passes through an ordinary exit without starting npm and cleans its request directory', async () => {
    const handoff = desktopUpdateHandoff(root);
    await expect(handoff.finish(7)).resolves.toBe(7);
    expect(runtime.runNpmUpdate).not.toHaveBeenCalled();
    expect(runtime.relaunchNpmApp).not.toHaveBeenCalled();
    expect(existsSync(dirname(handoff.request))).toBe(false);
  });

  it('installs only after the update exit code and keeps the replacement exit status', async () => {
    const handoff = desktopUpdateHandoff(root);
    const plan = {
      root,
      prefix: home,
      version: '1.0.0-beta.2',
      fromVersion: '1.0.0-beta.1',
    };
    writeFileSync(handoff.request, JSON.stringify(plan));
    expect(runtime.runNpmUpdate).not.toHaveBeenCalled();
    await expect(handoff.finish(42)).resolves.toBe(23);
    expect(runtime.runNpmUpdate).toHaveBeenCalledWith(plan);
    expect(runtime.relaunchNpmApp).toHaveBeenCalledWith(root, 'desktop');
    expect(runtime.runNpmUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.relaunchNpmApp.mock.invocationCallOrder[0]
    );
    expect(existsSync(dirname(handoff.request))).toBe(false);
  });

  it('rejects a request targeting a different installation', async () => {
    const handoff = desktopUpdateHandoff(root);
    writeFileSync(
      handoff.request,
      JSON.stringify({ root: '/different/installation' })
    );
    await expect(handoff.finish(42)).resolves.toBe(1);
    expect(runtime.runNpmUpdate).not.toHaveBeenCalled();
    expect(runtime.relaunchNpmApp).not.toHaveBeenCalled();
  });
});
