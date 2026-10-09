import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { npmUpdateFixture } from './npm-update-fixture.js';
import {
  prepareNpmUpdate,
  readNpmUpdateResult,
  relaunchNpmApp,
  runNpmUpdate,
} from './npm-update.js';

let fixture: Awaited<ReturnType<typeof npmUpdateFixture>>;
beforeEach(async () => {
  fixture = await npmUpdateFixture();
  for (const [key, value] of Object.entries(fixture.env))
    vi.stubEnv(key, value);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture.close();
  rmSync(fixture.home, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('npm update transaction', () => {
  it('installs the pinned package using real npm, records the result and returns the replacement exit code', async () => {
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
    await expect(relaunchNpmApp(fixture.root, 'tui')).resolves.toBe(23);
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
    writeFileSync(join(lock, 'owner'), 'another process');
    expect(await runNpmUpdate(plan)).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('Another npm update'),
    });
    expect(readFileSync(join(lock, 'owner'), 'utf8')).toBe('another process');
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
});
