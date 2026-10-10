import { accessSync, constants, statSync } from 'node:fs';
import { basename, delimiter, join, resolve } from 'node:path';
import type { SessionSpec } from '@n10/terminal';
import { AGENTS } from './agents/registry.js';

/** The variables a managed process finds its own session by. They
 *  locate it; they authorize nothing. */
export const MUX_ENV = {
  hostId: 'N10_MUX_HOST_ID',
  sessionId: 'N10_MUX_SESSION_ID',
  generation: 'N10_MUX_GENERATION',
  runtime: 'N10_MUX_RUNTIME',
} as const;

/** Inherited session identity a fresh launch never passes on: its own
 *  replaces a parent mux session's, and it runs in no tmux pane. */
const INHERITED_IDENTITY = new Set<string>([
  ...Object.values(MUX_ENV),
  'TMUX',
  'TMUX_PANE',
]);

/** Which session a launch is, for the environment it is given. */
export interface LaunchContext {
  hostId: string;
  sessionId: string;
  generation: number;
  /** The owner's runtime directory, when it serves mux clients. */
  runtimeDir?: string;
}

/** The spec with the session's own identity in place of any inherited. */
export function withSessionIdentity(
  spec: SessionSpec,
  context: LaunchContext
): SessionSpec {
  const inherited = Object.entries(spec.env ?? process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && !INHERITED_IDENTITY.has(entry[0])
  );
  return {
    ...spec,
    env: {
      ...Object.fromEntries(inherited),
      [MUX_ENV.hostId]: context.hostId,
      [MUX_ENV.sessionId]: context.sessionId,
      [MUX_ENV.generation]: String(context.generation),
      ...(context.runtimeDir ? { [MUX_ENV.runtime]: context.runtimeDir } : {}),
    },
  };
}

/** What a launch is known to run: a login shell, an agent the registry
 *  names by its executable, or a command n10 cannot vouch for. */
export type LaunchKind =
  | { kind: 'shell' }
  | { kind: 'agent'; agent: string }
  | { kind: 'unknown' };

const AGENT_EXECUTABLES = new Map(
  AGENTS.map((agent) => [agent.blank().cmd, agent.id])
);

export function launchKind(spec: SessionSpec): LaunchKind {
  if (!spec.cmd) return { kind: 'shell' };
  const executable = basename(spec.cmd).replace(/\.(exe|cmd|bat)$/i, '');
  const agent = AGENT_EXECUTABLES.get(executable);
  return agent ? { kind: 'agent', agent } : { kind: 'unknown' };
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(
    (candidate) => candidate.toUpperCase() === name
  );
  return key === undefined ? undefined : env[key];
}

/** As Windows looks a command up: a name that already ends in one of
 *  PATHEXT's extensions as it is, any other with each of them. A bare
 *  name is never run itself, so npm's extensionless shell script loses
 *  to its `.cmd` beside it. */
function windowsExtensions(command: string, env: NodeJS.ProcessEnv): string[] {
  const pathext = (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean);
  const named = pathext.some((extension) =>
    command.toUpperCase().endsWith(extension.toUpperCase())
  );
  return named ? [''] : pathext;
}

/**
 * The executable a command names, as the launch environment's PATH
 * finds it (with PATHEXT on Windows); a command with a directory part
 * is taken relative to `cwd`. `null` when there is none to run.
 */
export function resolveExecutable(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string
): string | null {
  const windows = process.platform === 'win32';
  if (command.includes('/') || (windows && command.includes('\\'))) {
    const path = resolve(cwd, command);
    return isExecutable(path) ? path : null;
  }
  const extensions = windows ? windowsExtensions(command, env) : [''];
  for (const dir of (envValue(env, 'PATH') ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const path = join(dir, command + extension);
      if (isExecutable(path)) return path;
    }
  }
  return null;
}
