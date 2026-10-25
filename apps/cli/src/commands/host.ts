import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HOST_USAGE = `Usage: n10 host --stdio [--start-dir <dir>]

Runs n10's session host on this machine for an n10 app elsewhere: n10
on Windows starts it inside WSL, and \`n10 --host=ssh:<machine>\` over
SSH. It speaks n10's protocol on stdin and stdout and logs to stderr.`;

export interface HostArgs {
  startDir?: string;
}

/** The host's arguments, or why they are wrong. */
export function parseHostArgs(args: string[]): HostArgs | string {
  let stdio = false;
  let startDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stdio') stdio = true;
    else if (arg === '--start-dir' && args[i + 1] !== undefined) {
      startDir = args[++i];
    } else return `n10 host: unknown argument '${arg}'`;
  }
  if (!stdio) return 'n10 host: only --stdio is supported';
  return startDir ? { startDir } : {};
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

/** The environment the host reads where the desktop's main process
 *  would otherwise set it (`main/host-env.ts`). */
export function hostEnvironment(
  env: NodeJS.ProcessEnv,
  version: string,
  args: HostArgs,
  home: string = homedir()
): NodeJS.ProcessEnv {
  return {
    ...env,
    N10_HOST_VERSION: version,
    N10_DESKTOP_VERSION: version,
    N10_USER_DATA: env.N10_USER_DATA || join(home, '.n10', 'host'),
    ...(args.startDir ? { N10_START_DIR: args.startDir } : {}),
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
