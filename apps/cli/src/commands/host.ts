import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HOST_USAGE = `Usage: n10 host --stdio [--start-dir <dir> [--start-distro <distro>]]

Runs n10's session host on this machine for an n10 app elsewhere: n10
on Windows starts it inside WSL, and \`n10 --host=ssh:<machine>\` over
SSH. It speaks n10's protocol on stdin and stdout and logs to stderr.`;

export interface HostArgs {
  startDir?: string;
  /** The WSL distro `startDir` belongs to, when the frontend could not
   *  tell which distro the host runs in. */
  startDistro?: string;
}

/** The host's arguments, or why they are wrong. */
export function parseHostArgs(args: string[]): HostArgs | string {
  let stdio = false;
  const parsed: HostArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg === '--stdio') stdio = true;
    else if (arg === '--start-dir' && value !== undefined) {
      parsed.startDir = value;
      i++;
    } else if (arg === '--start-distro' && value !== undefined) {
      parsed.startDistro = value;
      i++;
    } else return `n10 host: unknown argument '${arg}'`;
  }
  if (!stdio) return 'n10 host: only --stdio is supported';
  return parsed;
}

/** The host's script: the package's desktop build, or a checkout's. */
export function hostWorkerPath(
  root: string,
  exists: (path: string) => boolean = existsSync
): string | null {
  const candidates = [
    join(root, 'desktop', 'main', 'host-worker.js'),
    // apps/cli/dist in a checkout, beside apps/desktop/dist.
    resolve(root, '..', '..', 'desktop', 'dist', 'main', 'host-worker.js'),
  ];
  return candidates.find((path) => exists(path)) ?? null;
}

/** The start directory, unless it names another WSL distro's files. */
function startDir(env: NodeJS.ProcessEnv, args: HostArgs): string | undefined {
  if (!args.startDir || !args.startDistro) return args.startDir;
  const here = env.WSL_DISTRO_NAME?.toLowerCase();
  if (here === args.startDistro.toLowerCase()) return args.startDir;
  console.error(
    `n10 host: not opening ${args.startDir}: it is in WSL distro ${args.startDistro}, not this one`
  );
  return undefined;
}

/** The environment the host reads where the desktop's main process
 *  would otherwise set it (`main/host-env.ts`). */
export function hostEnvironment(
  env: NodeJS.ProcessEnv,
  version: string,
  args: HostArgs,
  home: string = homedir()
): NodeJS.ProcessEnv {
  const start = startDir(env, args);
  return {
    ...env,
    N10_HOST_VERSION: version,
    N10_DESKTOP_VERSION: version,
    N10_USER_DATA: env.N10_USER_DATA || join(home, '.n10', 'host'),
    ...(start ? { N10_START_DIR: start } : {}),
  };
}

/** Resolves with an exit code when the host cannot start, else never:
 *  the host exits the process itself when its frontend goes. */
export async function runHost(
  root: string,
  version: string,
  args: string[]
): Promise<number | undefined> {
  if (args.includes('--help') || args.includes('-h')) {
    console.error(HOST_USAGE);
    return 0;
  }
  const parsed = parseHostArgs(args);
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n\n${HOST_USAGE}`);
    return 2;
  }
  const worker = hostWorkerPath(root);
  if (!worker) {
    console.error(
      'n10 host: this build has no desktop host. From source, run `npx nx build-main desktop`.'
    );
    return 1;
  }
  Object.assign(process.env, hostEnvironment(process.env, version, parsed));
  await import(pathToFileURL(worker).href);
  return undefined;
}
