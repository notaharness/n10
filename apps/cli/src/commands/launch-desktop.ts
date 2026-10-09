import { superviseChild } from './child-supervision.js';
export { superviseChild, exitStatus } from './child-supervision.js';
import { desktopUpdateHandoff } from './desktop-update.js';
import { spawn, type SpawnOptions } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  statSync,
  type Stats,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Electron's setuid sandbox helper works only when root owns it with the
 * setuid bit. An npm install leaves it owned by the user, and Electron then
 * aborts with SIGTRAP, so the app runs unsandboxed instead.
 *
 * An Electron the user points at with ELECTRON_OVERRIDE_DIST_PATH may be a
 * distribution's build, which has no helper and sandboxes through user
 * namespaces, so Chromium's sandbox stays on. An unpacked stock release has
 * the helper, and is held to the same rule as an npm install.
 */
export function sandboxArgs(
  electron: string,
  platform: NodeJS.Platform = process.platform,
  stat: (path: string) => Pick<Stats, 'uid' | 'mode'> = statSync,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (platform !== 'linux') return [];
  try {
    const helper = stat(join(dirname(electron), 'chrome-sandbox'));
    return helper.uid === 0 && (helper.mode & 0o4755) === 0o4755
      ? []
      : ['--no-sandbox'];
  } catch {
    // No helper: a supplied build sandboxes without it, and an npm one
    // has nothing to sandbox with.
    return env.ELECTRON_OVERRIDE_DIST_PATH ? [] : ['--no-sandbox'];
  }
}

/**
 * Why requiring the electron package failed: it is missing, or its
 * first-run download failed, which Electron has already explained on
 * stderr. A root-owned install (`sudo npm install -g`) cannot download
 * as the user, so that case names the one-time fix.
 */
export function electronFailure(
  error: unknown,
  resolveElectron: () => string,
  writable: (dir: string) => boolean = isWritable
): string {
  if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
    return 'n10: Electron is not installed. Reinstall @notaharness/n10, or run `n10 --tui`.';
  }
  const dir = dirname(resolveElectron());
  if (!writable(dir)) {
    return `n10: cannot download Electron into ${dir}. Run \`sudo node ${join(
      dir,
      'install.js'
    )}\` once, or run \`n10 --tui\`.`;
  }
  return 'n10: could not download Electron. Check your connection and run `n10` again, or run `n10 --tui`.';
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * How Electron is spawned. It gets its own process group: a terminal's
 * Ctrl+C or hangup then reaches only the launcher, which forwards it once.
 * In the launcher's group Electron would get the terminal's copy as well,
 * and its second signal kills it before it has quit. Its stdio stays
 * attached to the terminal.
 */
export function electronSpawnOptions(
  version: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): SpawnOptions {
  return {
    stdio: 'inherit',
    detached: true,
    // Launching from inside a repo opens that repo.
    env: { ...env, N10_START_DIR: cwd, N10_DESKTOP_VERSION: version },
  };
}

/**
 * Runs Electron on the app in `root`, the package directory, whose manifest
 * names `desktop/main/main.js` as the main script. Resolves with Electron's
 * exit code.
 */
export function launchDesktop(root: string, version: string): Promise<number> {
  if (!existsSync(join(root, 'desktop', 'main', 'main.js'))) {
    console.error(
      'n10: this build has no desktop app. From source, run `npx nx serve desktop`.'
    );
    return Promise.resolve(1);
  }
  const require = createRequire(import.meta.url);
  let electron: string;
  try {
    // The electron package's main export is the path to its binary,
    // which it downloads the first time it is required.
    electron = require('electron') as string;
  } catch (error) {
    console.error(electronFailure(error, () => require.resolve('electron')));
    return Promise.resolve(1);
  }
  const args = sandboxArgs(electron);
  if (args.length > 0) {
    console.warn(
      '[n10] SUID sandbox unavailable — launching with --no-sandbox'
    );
  }
  const handoff = desktopUpdateHandoff(root);
  const options = electronSpawnOptions(version, {
    ...process.env,
    N10_UPDATE_HANDOFF: handoff.request,
  });
  const child = spawn(electron, [...args, root], options);
  return superviseChild(child).then((code) => handoff.finish(code));
}
