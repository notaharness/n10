import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectUpdateInstallation,
  updateSource,
} from './update-installation.js';
import { createUpdateStore } from './update-store.js';

const homes: string[] = [];
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'n10-update-unit-'));
  homes.push(home);
  const root = join(home, 'node_modules/@notaharness/n10');
  mkdirSync(root, { recursive: true });
  const manifest = (extra = {}) =>
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: '@notaharness/n10',
        version: '1.0.0-beta.1',
        ...extra,
      })
    );
  manifest();
  return { home, root, manifest };
}
afterEach(() => {
  for (const home of homes.splice(0))
    rmSync(home, { recursive: true, force: true });
});
describe('installation and persisted update state', () => {
  it('only identifies a global npm install when its real path matches the active prefix', async () => {
    const { home, root, manifest } = fixture();
    const prefix = vi.fn().mockResolvedValue(join(home, 'node_modules'));
    await expect(
      detectUpdateInstallation(root, false, prefix)
    ).resolves.toEqual({ kind: 'npm-global', version: '1.0.0-beta.1' });
    await expect(
      detectUpdateInstallation(root, false, async () => '/not-this-prefix')
    ).resolves.toMatchObject({ kind: 'npm-local' });
    manifest({ nx: {} });
    prefix.mockClear();
    await expect(
      detectUpdateInstallation(root, false, prefix)
    ).resolves.toMatchObject({ kind: 'development' });
    expect(prefix).not.toHaveBeenCalled();
    manifest({ private: true, name: 'n10-desktop' });
    await expect(
      detectUpdateInstallation(root, true, prefix)
    ).resolves.toMatchObject({ kind: 'packaged' });
  });
  it('does not invoke npm for a published manifest outside an npm install layout', async () => {
    const { home } = fixture();
    const root = join(home, 'nix/store/n10');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: '@notaharness/n10', version: '1.0.0-beta.1' })
    );
    const prefix = vi.fn();
    await expect(
      detectUpdateInstallation(root, false, prefix)
    ).resolves.toMatchObject({ kind: 'packaged' });
    expect(prefix).not.toHaveBeenCalled();
  });
  it('ignores fixture overrides in installed copies and refuses a non-loopback fixture', () => {
    const env = { N10_UPDATE_TEST_REGISTRY: 'http://example.com/dist-tags' };
    expect(
      updateSource({ kind: 'npm-global', version: '1.0.0' }, env).source
    ).toBe('npm');
    expect(() =>
      updateSource({ kind: 'development', version: 'dev' }, env)
    ).toThrow('loopback');
  });
  it('preferences survive another store and cache writes cannot overwrite them', () => {
    const { home } = fixture();
    const store = createUpdateStore('npm', home);
    store.writePreferences({ channel: 'stable', automatic: false });
    store.writeCache({
      version: '1.0.0-beta.10',
      checkedAt: 123,
      retryAt: 456,
      error: 'offline',
    });
    const reopened = createUpdateStore('npm', home);
    expect(reopened.readPreferences()).toEqual({
      channel: 'stable',
      automatic: false,
    });
    expect(reopened.readCache()).toMatchObject({
      version: '1.0.0-beta.10',
      checkedAt: 123,
      retryAt: 456,
      error: 'offline',
    });
    expect(
      createUpdateStore('fixture', home).readCache().version
    ).toBeUndefined();
  });
});
