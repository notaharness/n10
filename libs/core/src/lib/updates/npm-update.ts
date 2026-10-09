import { assertNpmUpdateWritable } from './npm-update-access.js';
import { acquireNpmUpdateLock } from './npm-update-lock.js';
import { protectNpmTransaction } from './npm-update-signals.js';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { detectUpdateInstallation } from './update-installation.js';
import { newerRelease } from './update-registry.js';

export interface NpmUpdatePlan {
  root: string;
  prefix: string;
  version: string;
  fromVersion: string;
}
export interface NpmUpdateResult {
  root: string;
  fromVersion: string;
  version: string;
  status: 'succeeded' | 'failed';
  message: string;
  logPath: string;
}
const npmRead = async (args: string[]) =>
  (await promisify(execFile)('npm', args, { timeout: 5000 })).stdout.trim();

/** Read-only preflight. Repeated immediately before mutation by the owner. */
export async function prepareNpmUpdate(
  root: string,
  version: string
): Promise<NpmUpdatePlan> {
  if (process.platform === 'win32')
    throw new Error('On Windows, use the manual npm update command.');
  const installation = await detectUpdateInstallation(root);
  if (installation.kind !== 'npm-global')
    throw new Error(
      'This is not the current global npm installation. Use the manual update command.'
    );
  if (!newerRelease(version, installation.version))
    throw new Error(
      'The requested version is no longer newer than this installation. Check again.'
    );
  const canonical = await realpath(root);
  const prefix = await npmRead(['prefix', '--global']);
  await assertNpmUpdateWritable(canonical, prefix);
  return {
    root: canonical,
    prefix,
    version,
    fromVersion: installation.version,
  };
}

function install(
  plan: NpmUpdatePlan,
  logs: string,
  signals: ReturnType<typeof protectNpmTransaction>
): Promise<void> {
  return new Promise((resolve, reject) => {
    // No shell, elevation, timeout or automatic retry around a package mutation.
    const child = spawn(
      'npm',
      [
        'install',
        '--global',
        '--prefix',
        plan.prefix,
        `@notaharness/n10@${plan.version}`,
        '--no-audit',
        '--no-fund',
        '--logs-dir',
        logs,
      ],
      {
        cwd: homedir(),
        stdio: 'inherit',
      }
    );
    signals.watch(child);
    child.once('error', reject);
    child.once('close', (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `npm exited ${signal ?? code}. Run npm i -g @notaharness/n10@${
                plan.version
              } to retry.`
            )
          )
    );
  });
}

/** Caller has already unmounted/drained the TUI, or waited for Electron exit. */
export async function runNpmUpdate(
  plan: NpmUpdatePlan
): Promise<NpmUpdateResult> {
  const dir = join(homedir(), '.n10');
  const logPath = join(dir, 'npm-update-logs');
  const signals = protectNpmTransaction();
  let release: () => Promise<void> = async () => undefined;
  let result: NpmUpdateResult;
  try {
    await mkdir(logPath, { recursive: true });
    release = await acquireNpmUpdateLock(dir);
    const current = await prepareNpmUpdate(plan.root, plan.version);
    if (
      current.prefix !== plan.prefix ||
      current.fromVersion !== plan.fromVersion
    )
      throw new Error(
        'The npm installation changed. Reopen n10 and check again.'
      );
    await install(current, logPath, signals);
    const manifest = JSON.parse(
      await readFile(join(plan.root, 'package.json'), 'utf8')
    ) as { version: string };
    if (manifest.version !== plan.version)
      throw new Error(
        'npm finished without installing the requested version. Check the npm log.'
      );
    result = {
      root: plan.root,
      fromVersion: plan.fromVersion,
      version: plan.version,
      status: 'succeeded',
      message: `Updated to n10 ${plan.version}.`,
      logPath,
    };
  } catch (error) {
    result = {
      root: plan.root,
      fromVersion: plan.fromVersion,
      version: plan.version,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      logPath,
    };
  }
  try {
    await writeFile(
      join(dir, 'npm-update-result.json'),
      JSON.stringify(result),
      {
        mode: 0o600,
      }
    );
    return result;
  } finally {
    try {
      await release();
    } finally {
      signals.dispose();
    }
  }
}

export function readNpmUpdateResult(root: string): NpmUpdateResult | null {
  try {
    const result = JSON.parse(
      readFileSync(join(homedir(), '.n10/npm-update-result.json'), 'utf8')
    ) as NpmUpdateResult;
    const installed = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    ) as { version: string };
    const relevantVersion =
      result.status === 'succeeded' ? result.version : result.fromVersion;
    return installed.version === relevantVersion &&
      result.root === realpathSync(root) &&
      ['succeeded', 'failed'].includes(result.status) &&
      typeof result.message === 'string' &&
      typeof result.logPath === 'string'
      ? result
      : null;
  } catch {
    return null;
  }
}
