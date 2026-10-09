import { execFile, spawn } from 'node:child_process';
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { constants, readFileSync, realpathSync } from 'node:fs';
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
  await access(canonical, constants.W_OK);
  await access(join(canonical, '..'), constants.W_OK);
  const prefix = await npmRead(['prefix', '--global']);
  await access(join(prefix, 'bin'), constants.W_OK);
  return {
    root: canonical,
    prefix,
    version,
    fromVersion: installation.version,
  };
}

async function acquireLock(dir: string) {
  const lock = join(dir, 'npm-update.lock');
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(
      `Another npm update may be running. If it has stopped, remove ${lock} and try again.`
    );
  }
  return async () => {
    await rm(lock, { recursive: true, force: true });
  };
}

function install(plan: NpmUpdatePlan, logs: string): Promise<void> {
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
  await mkdir(logPath, { recursive: true });
  let release: () => Promise<void> = async () => undefined;
  let result: NpmUpdateResult;
  try {
    release = await acquireLock(dir);
    const current = await prepareNpmUpdate(plan.root, plan.version);
    if (
      current.prefix !== plan.prefix ||
      current.fromVersion !== plan.fromVersion
    )
      throw new Error(
        'The npm installation changed. Reopen n10 and check again.'
      );
    await install(current, logPath);
    const manifest = JSON.parse(
      await readFile(join(plan.root, 'package.json'), 'utf8')
    ) as { version: string };
    if (manifest.version !== plan.version)
      throw new Error(
        'npm finished without installing the requested version. Check the npm log.'
      );
    result = {
      root: plan.root,
      version: plan.version,
      status: 'succeeded',
      message: `Updated to n10 ${plan.version}.`,
      logPath,
    };
  } catch (error) {
    result = {
      root: plan.root,
      version: plan.version,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      logPath,
    };
  } finally {
    await release();
  }
  await writeFile(join(dir, 'npm-update-result.json'), JSON.stringify(result), {
    mode: 0o600,
  });
  return result;
}

export function readNpmUpdateResult(root: string): NpmUpdateResult | null {
  try {
    const result = JSON.parse(
      readFileSync(join(homedir(), '.n10/npm-update-result.json'), 'utf8')
    ) as NpmUpdateResult;
    return result.root === realpathSync(root) &&
      ['succeeded', 'failed'].includes(result.status) &&
      typeof result.message === 'string' &&
      typeof result.logPath === 'string'
      ? result
      : null;
  } catch {
    return null;
  }
}

/** Keeps the calling terminal owned until the replacement app exits. */
export function relaunchNpmApp(
  root: string,
  mode: 'desktop' | 'tui'
): Promise<number> {
  const env = { ...process.env };
  delete env.N10_UPDATE_HANDOFF;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(root, 'main.js'),
        ...(mode === 'tui' ? ['--tui', process.cwd()] : []),
      ],
      { stdio: 'inherit', env }
    );
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}
