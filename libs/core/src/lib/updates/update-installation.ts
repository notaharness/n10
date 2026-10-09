import { execFile } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { N10_REGISTRY, validReleaseVersion } from './update-registry.js';
import type { UpdateInstallation } from './update-types.js';

async function npmGlobalRoot(): Promise<string> {
  const { stdout } = await promisify(execFile)('npm', ['root', '--global'], {
    timeout: 5000,
  });
  return stdout.trim();
}

/** The published manifest is distinguishable from workspace/build manifests. */
export async function detectUpdateInstallation(
  root: string,
  packaged = false,
  globalRoot = npmGlobalRoot
): Promise<UpdateInstallation> {
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    ) as { version?: string; name?: string; nx?: unknown; private?: boolean };
    if (!validReleaseVersion(manifest.version))
      return { version: 'dev', kind: 'development' };
    if (packaged) return { version: manifest.version, kind: 'packaged' };
    if (manifest.nx || manifest.private)
      return { version: 'dev', kind: 'development' };
    if (manifest.name !== '@notaharness/n10')
      return { version: 'dev', kind: 'development' };
    const installation: UpdateInstallation = {
      version: manifest.version,
      kind: 'npm-local',
    };
    try {
      const prefix = await globalRoot();
      if (realpathSync(join(prefix, '@notaharness/n10')) === realpathSync(root))
        installation.kind = 'npm-global';
    } catch {
      /* An unverified npm prefix gets instructions, never a global update action. */
    }
    return installation;
  } catch {
    return { version: 'dev', kind: 'development' };
  }
}

/** Explicit loopback-only fixture seam, ignored by published installations. */
export function updateSource(
  installation: UpdateInstallation,
  env: NodeJS.ProcessEnv = process.env
) {
  const fixture = env.N10_UPDATE_TEST_REGISTRY;
  if (installation.kind === 'development' && fixture) {
    const url = new URL(fixture);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
      throw new Error('Update fixture must use loopback HTTP.');
    return {
      url: url.href,
      installation: {
        kind: 'npm-global',
        version: '1.0.0-beta.1',
      } as UpdateInstallation,
      source: 'fixture',
    };
  }
  return { url: N10_REGISTRY, installation, source: 'npm' };
}
