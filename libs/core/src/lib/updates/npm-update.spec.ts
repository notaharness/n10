import { spawnSync } from 'node:child_process';
import { detectUpdateInstallation } from './update-installation.js';
import { tmpdir } from 'node:os';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { npmUpdateFixture } from '../../testing/npm-update.js';
import {
  prepareNpmUpdate,
  readNpmUpdateResult,
  runNpmUpdate,
} from './npm-update.js';

let fixture: Awaited<ReturnType<typeof npmUpdateFixture>>;
beforeEach(async () => {
  fixture = await npmUpdateFixture(
    mkdtempSync(join(tmpdir(), 'n10-npm-update-test-')),
    '#!/usr/bin/env node\nconsole.log("replacement n10");\nprocess.exit(23);\n',
    false
  );
  for (const [key, value] of Object.entries(fixture.env))
    vi.stubEnv(key, value);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture.close();
  rmSync(fixture.home, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('npm update transaction', () => {
  it('installs the pinned package using real npm, records the result', async () => {
    const plan = await prepareNpmUpdate(fixture.root, fixture.version);
    expect(fixture.requests).toEqual([]);
    const result = await runNpmUpdate(plan);
    expect(result.status).toBe('succeeded');
    expect(
      JSON.parse(readFileSync(join(fixture.root, 'package.json'), 'utf8'))
        .version
    ).toBe(fixture.version);
    expect(fixture.requests).toContain('/n10.tgz');
    expect(readNpmUpdateResult(fixture.root)).toEqual(result);
  }, 20000);

  it('refuses another installation and refuses a prefix changed after preflight', async () => {
    const plan = await prepareNpmUpdate(fixture.root, fixture.version);
    vi.stubEnv('npm_config_prefix', join(fixture.home, 'other-prefix'));
    await expect(
      prepareNpmUpdate(fixture.root, fixture.version)
    ).rejects.toThrow('not the current global npm installation');
    expect((await runNpmUpdate(plan)).status).toBe('failed');
    expect(fixture.requests).toEqual([]);
  }, 20000);

  it('leaves a competing update lock intact and never invokes the registry', async () => {
    const plan = await prepareNpmUpdate(fixture.root, fixture.version);
    const lock = join(fixture.home, '.n10/npm-update.lock');
    mkdirSync(lock, { recursive: true });
    const owner = join(lock, String(process.pid));
    writeFileSync(owner, String(process.pid));
    expect(await runNpmUpdate(plan)).toMatchObject({
      status: 'failed',
      message: expect.stringContaining(
        `If no update is running, remove ${lock} and try again.`
      ),
    });
    expect(readFileSync(owner, 'utf8')).toBe(String(process.pid));
    expect(fixture.requests).toEqual([]);
  }, 20000);

  it('records an npm failure and releases the lock so a later retry can succeed', async () => {
    const plan = await prepareNpmUpdate(fixture.root, fixture.version);
    fixture.scenario.fail = true;
    expect((await runNpmUpdate(plan)).status).toBe('failed');
    expect(readNpmUpdateResult(fixture.root)?.status).toBe('failed');
    fixture.scenario.fail = false;
    expect((await runNpmUpdate(plan)).status).toBe('succeeded');
  }, 20000);

  it('reclaims a dead owner without manual cleanup', async () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    const lock = join(fixture.home, '.n10/npm-update.lock');
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, String(dead)), String(dead));
    expect(
      (
        await runNpmUpdate(
          await prepareNpmUpdate(fixture.root, fixture.version)
        )
      ).status
    ).toBe('succeeded');
    expect(existsSync(lock)).toBe(false);
  }, 20000);

  it('rejects an aliased prefix that still identifies the same installation', async () => {
    const plan = await prepareNpmUpdate(fixture.root, fixture.version);
    const alias = join(fixture.home, 'alias');
    symlinkSync(fixture.prefix, alias);
    vi.stubEnv('npm_config_prefix', alias);
    expect((await prepareNpmUpdate(fixture.root, fixture.version)).prefix).toBe(
      alias
    );
    expect(await runNpmUpdate(plan)).toMatchObject({
      status: 'failed',
      message: 'The npm installation changed. Reopen n10 and check again.',
    });
    expect(fixture.requests).toEqual([]);
  }, 20000);

  it('rejects a changed installed version that is still below the approved target', async () => {
    const plan = await prepareNpmUpdate(fixture.root, fixture.version);
    const manifest = join(fixture.root, 'package.json');
    writeFileSync(
      manifest,
      JSON.stringify({
        ...JSON.parse(readFileSync(manifest, 'utf8')),
        version: '1.0.0-beta.1.1',
      })
    );
    expect(
      (await prepareNpmUpdate(fixture.root, fixture.version)).fromVersion
    ).toBe('1.0.0-beta.1.1');
    expect(await runNpmUpdate(plan)).toMatchObject({
      status: 'failed',
      message: 'The npm installation changed. Reopen n10 and check again.',
    });
    expect(fixture.requests).toEqual([]);
  }, 20000);

  it.skipIf(process.getuid?.() === 0)(
    'offers actionable manual guidance when the prefix needs administrator rights',
    async () => {
      chmodSync(fixture.root, 0o555);
      try {
        expect(await detectUpdateInstallation(fixture.root)).toMatchObject({
          kind: 'npm-global',
          manualUpdateReason: expect.stringContaining('administrator rights'),
        });
        await expect(
          prepareNpmUpdate(fixture.root, fixture.version)
        ).rejects.toThrow('npm needs administrator rights');
      } finally {
        chmodSync(fixture.root, 0o755);
      }
    }
  );

  it.each(['succeeded', 'failed'] as const)(
    'ignores a %s result after a manual update',
    (status) => {
      const result = {
        root: fixture.root,
        fromVersion: '1.0.0-beta.1',
        version: fixture.version,
        status,
        message: 'Update result',
        logPath: '/logs',
      };
      const manifest = join(fixture.root, 'package.json');
      const content = JSON.parse(readFileSync(manifest, 'utf8'));
      const installed =
        status === 'succeeded' ? result.version : result.fromVersion;
      writeFileSync(
        manifest,
        JSON.stringify({ ...content, version: installed })
      );
      mkdirSync(join(fixture.home, '.n10'), { recursive: true });
      writeFileSync(
        join(fixture.home, '.n10/npm-update-result.json'),
        JSON.stringify(result)
      );
      expect(readNpmUpdateResult(fixture.root)).toEqual(result);
      writeFileSync(
        manifest,
        JSON.stringify({ ...content, version: '1.0.0-beta.3' })
      );
      expect(readNpmUpdateResult(fixture.root)).toBeNull();
    }
  );
});
