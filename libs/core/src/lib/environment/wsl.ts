/**
 * Whether n10 runs inside WSL, and which of its setups n10 supports.
 *
 * WSL 2 runs a real Linux kernel, whose release names it
 * (`…-microsoft-standard-WSL2`); WSL 1 translates Linux calls on the
 * Windows kernel and reports a release ending in `-Microsoft`. Windows
 * drives appear under `/mnt/<letter>` through drvfs, as a 9p mount with
 * `aname=drvfs` on WSL 2. A repository there works, slowly, through a
 * filesystem with Windows semantics; n10 supports Linux storage only.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';

export interface WslEnvironment {
  version: 1 | 2;
  /** `WSL_DISTRO_NAME`, which WSL sets in every process it starts. */
  distro: string | null;
  /** Windows executables can be started from Linux (`explorer.exe`). */
  interop: boolean;
}

/** What detection reads, injectable for tests. */
export interface WslProbe {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** A file's text, or null when it cannot be read. */
  readFile(path: string): string | null;
  exists(path: string): boolean;
}

const INTEROP_ENTRIES = [
  '/proc/sys/fs/binfmt_misc/WSLInterop',
  // The entry's name when systemd's binfmt setup runs before WSL's.
  '/proc/sys/fs/binfmt_misc/WSLInterop-late',
];

export function nodeWslProbe(): WslProbe {
  return {
    platform: process.platform,
    env: process.env,
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    exists: existsSync,
  };
}

/** The WSL this process runs in, or null outside WSL. */
export function detectWsl(probe: WslProbe): WslEnvironment | null {
  if (probe.platform !== 'linux') return null;
  const release = probe.readFile('/proc/sys/kernel/osrelease')?.trim() ?? '';
  const distro = probe.env['WSL_DISTRO_NAME'] || null;
  if (!/microsoft|wsl/i.test(release) && !distro) return null;
  return {
    // Only WSL 1 lacks a Linux kernel; a custom WSL 2 kernel may name
    // itself anything.
    version: /-Microsoft$/.test(release) ? 1 : 2,
    distro,
    interop: INTEROP_ENTRIES.some((entry) => probe.exists(entry)),
  };
}

let detected: WslEnvironment | null | undefined;

/** {@link detectWsl} for this process, read once. */
export function wslEnvironment(): WslEnvironment | null {
  if (detected === undefined) detected = detectWsl(nodeWslProbe());
  return detected;
}

export interface MountEntry {
  mountPoint: string;
  fsType: string;
  source: string;
  superOptions: string;
}

/** `/proc/self/mountinfo` decoded: mount points escape space, tab,
 *  newline and backslash as octal. */
export function parseMountInfo(text: string): MountEntry[] {
  const unescape = (value: string) =>
    value.replace(/\\([0-7]{3})/g, (_, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8))
    );
  const entries: MountEntry[] = [];
  for (const line of text.split('\n')) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    if (separator < 5 || fields.length < separator + 3) continue;
    entries.push({
      mountPoint: unescape(fields[4]!),
      fsType: fields[separator + 1]!,
      source: unescape(fields[separator + 2]!),
      superOptions: fields[separator + 3] ?? '',
    });
  }
  return entries;
}

function isWindowsDrive(mount: MountEntry): boolean {
  return (
    mount.fsType === 'drvfs' ||
    /(^|[,;])aname=drvfs([,;]|$)/.test(mount.superOptions) ||
    /^[A-Za-z]:\\?$/.test(mount.source)
  );
}

/** The Windows drive mount holding `path` (already resolved), or null
 *  when the mount it lives on is a Linux filesystem. */
export function windowsDriveMount(
  path: string,
  mounts: readonly MountEntry[]
): MountEntry | null {
  let owner: MountEntry | null = null;
  for (const mount of mounts) {
    const point = mount.mountPoint;
    const holds =
      path === point ||
      path.startsWith(point.endsWith('/') ? point : `${point}/`);
    if (holds && (!owner || point.length >= owner.mountPoint.length)) {
      owner = mount;
    }
  }
  return owner && isWindowsDrive(owner) ? owner : null;
}

/** {@link windowsDriveMount} for a path on this machine, following
 *  symlinks: a Linux path can link onto a Windows drive. */
export function windowsDriveOf(
  path: string,
  probe: WslProbe = nodeWslProbe()
): MountEntry | null {
  const mountInfo = probe.readFile('/proc/self/mountinfo');
  if (!mountInfo) return null;
  let resolved = path;
  try {
    resolved = realpathSync(path);
  } catch {
    // An unreadable path is judged by its spelling.
  }
  return windowsDriveMount(resolved, parseMountInfo(mountInfo));
}
