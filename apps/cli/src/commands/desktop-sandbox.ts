import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, type Stats } from 'node:fs';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';

const APPARMOR_USERNS =
  '/proc/sys/kernel/apparmor_restrict_unprivileged_userns';

/**
 * Chromium sandboxes its Linux processes in unprivileged user namespaces
 * when the kernel lets it, and falls back to its setuid helper otherwise.
 * That helper works only when root owns it with the setuid bit; an npm
 * install leaves it owned by the user, and Electron then aborts with
 * SIGTRAP, so with neither the app runs unsandboxed.
 *
 * An Electron the user points at with ELECTRON_OVERRIDE_DIST_PATH may be a
 * distribution's build, which has no helper and is trusted to sandbox
 * without one. An unpacked stock release has the helper, and is held to the
 * same rule as an npm install. N10_NO_SANDBOX=1 turns the sandbox off
 * wherever it would abort the launch.
 */
export function sandboxArgs(
  electron: string,
  platform: NodeJS.Platform = process.platform,
  stat: (path: string) => Pick<Stats, 'uid' | 'mode'> = statSync,
  env: NodeJS.ProcessEnv = process.env,
  userNamespaces: () => boolean = canSandboxInNamespaces
): string[] {
  if (platform !== 'linux') return [];
  if (env.N10_NO_SANDBOX === '1') return ['--no-sandbox'];
  const helper = setuidHelper(electron, stat);
  if (helper === 'usable' || userNamespaces()) return [];
  return helper === 'missing' && env.ELECTRON_OVERRIDE_DIST_PATH
    ? []
    : ['--no-sandbox'];
}

function setuidHelper(
  electron: string,
  stat: (path: string) => Pick<Stats, 'uid' | 'mode'>
): 'usable' | 'unusable' | 'missing' {
  try {
    const helper = stat(join(dirname(electron), 'chrome-sandbox'));
    return helper.uid === 0 && (helper.mode & 0o4755) === 0o4755
      ? 'usable'
      : 'unusable';
  } catch {
    return 'missing';
  }
}

/**
 * Whether Electron can create the namespaces Chromium's sandbox uses.
 * Where AppArmor restricts unprivileged user namespaces (Ubuntu 24.04 and
 * later), it decides per program, and `unshare` may be allowed while an npm
 * install's Electron is not, so the restriction alone answers no. Without
 * it, the probe maps root and creates network and PID namespaces as the
 * sandbox does: a bare user namespace can succeed where those fail.
 */
export function canSandboxInNamespaces(
  restricted: () => boolean = appArmorRestrictsNamespaces,
  run: typeof spawnSync = spawnSync
): boolean {
  if (restricted()) return false;
  const probe = run(
    'unshare',
    ['--user', '--map-root-user', '--net', '--pid', '--fork', 'true'],
    { stdio: 'ignore', timeout: 2_000 }
  );
  return probe.status === 0;
}

function appArmorRestrictsNamespaces(): boolean {
  try {
    return readFileSync(APPARMOR_USERNS, 'utf8').trim() === '1';
  } catch {
    return false;
  }
}

/** What the launcher says before starting Electron without the sandbox. */
export function unsandboxedWarning(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.N10_NO_SANDBOX === '1'
    ? "n10: running without Chromium's sandbox (N10_NO_SANDBOX=1)."
    : "n10: running without Chromium's sandbox.";
}

/**
 * What to tell someone whose Electron aborted (SIGTRAP, as Chromium does
 * when no sandbox is usable) after starting with the sandbox on, or null.
 */
export function sandboxAbortHint(
  status: number,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform !== 'linux' || args.includes('--no-sandbox')) return null;
  if (status !== 128 + constants.signals.SIGTRAP) return null;
  return "n10: stopped unexpectedly. If the error above says no sandbox is usable, run `N10_NO_SANDBOX=1 n10` to start without Chromium's sandbox.";
}
