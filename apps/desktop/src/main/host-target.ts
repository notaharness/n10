/**
 * Where the session host runs. The frontend (Electron main, preload and
 * renderer) runs where the user sits; the host — the engine, Git,
 * tmux, agents — runs on this computer, in a WSL distro, or on a
 * machine reached over SSH, the way an editor's remote server does.
 *
 * Chosen at launch with `--host=<spec>` or `N10_HOST`:
 * `local`, `wsl`, `wsl:<distro>` or `ssh:<destination>`. Windows has
 * no local host (tmux, `/proc`, POSIX shells), so it defaults to WSL's
 * default distro; everywhere else to `local`.
 */

export type HostTarget =
  | { kind: 'local' }
  | { kind: 'wsl'; distro?: string }
  | { kind: 'ssh'; destination: string };

export const HOST_FLAG = '--host=';

export function parseHostTarget(
  spec: string | undefined,
  platform: NodeJS.Platform
): HostTarget {
  const value = spec?.trim();
  if (!value) return platform === 'win32' ? { kind: 'wsl' } : { kind: 'local' };
  if (value === 'local') return { kind: 'local' };
  if (value === 'wsl') return { kind: 'wsl' };
  if (value.startsWith('wsl:') && value.length > 4) {
    return { kind: 'wsl', distro: value.slice(4) };
  }
  // An ssh destination never starts with `-`, which ssh would read as
  // an option.
  if (value.startsWith('ssh:') && value.length > 4 && value[4] !== '-') {
    return { kind: 'ssh', destination: value.slice(4) };
  }
  throw new Error(
    `n10: unknown host '${value}'. Use local, wsl, wsl:<distro> or ssh:<destination>.`
  );
}

/** The target a launch names: the last `--host=` argument, else
 *  `N10_HOST`. */
export function launchHostTarget(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): HostTarget {
  const flag = [...argv].reverse().find((arg) => arg.startsWith(HOST_FLAG));
  return parseHostTarget(
    flag ? flag.slice(HOST_FLAG.length) : env.N10_HOST,
    platform
  );
}

/** The target in the user's words. */
export function hostLabel(target: HostTarget, distro?: string): string {
  switch (target.kind) {
    case 'local':
      return 'this computer';
    case 'wsl':
      return `WSL (${target.distro ?? distro ?? 'default distro'})`;
    case 'ssh':
      return target.destination;
  }
}

/** POSIX shell single quoting. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export interface HostCommand {
  file: string;
  args: string[];
}

export interface HostCommandOptions {
  /** A directory on the target to open first. */
  startDir?: string;
  /** How the target runs n10: `N10_HOST_COMMAND`, else `n10`. A path
   *  to a checkout's build works too (`node ~/src/n10/dist/main.js`). */
  command?: string;
}

/** What runs the host on the target: the user's login shell, so the
 *  PATH it sets up (nvm, ~/.local/bin, Homebrew) finds n10, node, tmux
 *  and the agents, then `n10 host --stdio`. */
export function remoteScript(options: HostCommandOptions): string {
  const command = options.command?.trim() || 'n10';
  const start = options.startDir
    ? ` --start-dir ${shellQuote(options.startDir)}`
    : '';
  return `exec ${command} host --stdio${start}`;
}

/** Runs `script` under the target user's login shell, from `sh`. */
const LOGIN_SHELL = 'exec "${SHELL:-/bin/sh}" -lc "$1"';

export function hostCommand(
  target: Exclude<HostTarget, { kind: 'local' }>,
  options: HostCommandOptions
): HostCommand {
  const script = remoteScript(options);
  if (target.kind === 'wsl') {
    return {
      file: 'wsl.exe',
      args: [
        ...(target.distro ? ['--distribution', target.distro] : []),
        '--cd',
        '~',
        '--exec',
        'sh',
        '-c',
        LOGIN_SHELL,
        'n10-host',
        script,
      ],
    };
  }
  // ssh hands the remote side one string for the user's shell. The
  // pipe is the protocol: no terminal, and no prompt waiting on it.
  return {
    file: 'ssh',
    args: [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ServerAliveInterval=15',
      target.destination,
      '--',
      `sh -c ${shellQuote(LOGIN_SHELL)} n10-host ${shellQuote(script)}`,
    ],
  };
}

const WSL_UNC = /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(\\.*)?$/i;
const DRIVE = /^([a-zA-Z]):[\\/](.*)$/;

/**
 * A Windows path as the WSL distro `distro` sees it: its own files
 * through `\\wsl.localhost\<distro>\…` (or `\\wsl$\…`), and a drive
 * through `/mnt/<drive>/…`. Null for another distro's files, or a path
 * WSL cannot reach.
 */
export function wslPath(windowsPath: string, distro?: string): string | null {
  const unc = WSL_UNC.exec(windowsPath);
  if (unc) {
    const [, name, rest] = unc;
    if (distro && name?.toLowerCase() !== distro.toLowerCase()) return null;
    return (rest ?? '\\').replaceAll('\\', '/');
  }
  const drive = DRIVE.exec(windowsPath);
  if (drive) {
    const [, letter, rest] = drive;
    const tail = (rest ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
    return `/mnt/${letter?.toLowerCase()}${tail ? `/${tail}` : ''}`;
  }
  return null;
}

/** Where Windows sees the distro's `linuxPath`. */
export function windowsPathInWsl(distro: string, linuxPath: string): string {
  return `\\\\wsl.localhost\\${distro}${linuxPath.replaceAll('/', '\\')}`;
}

/**
 * The start directory to hand a host on `target`, from one the
 * frontend was given. A remote host only takes a directory that names
 * its own files: a WSL path a Windows terminal started in, or a POSIX
 * path given outright. Not a Windows drive: where a Windows terminal
 * happened to be, most often the home folder, is not a repository the
 * user means to open in Linux.
 */
export function remoteStartDir(
  target: HostTarget,
  dir: string | undefined
): string | undefined {
  if (!dir || target.kind === 'local') return dir;
  if (dir.startsWith('/')) return dir;
  if (target.kind === 'wsl' && WSL_UNC.test(dir)) {
    return wslPath(dir, target.distro) ?? undefined;
  }
  return undefined;
}
