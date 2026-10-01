import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import {
  worktreeScope,
  type Machine,
  type MachineExecutor,
  type WorktreeScope,
} from '@n10/worktree-manager';

/**
 * Paths named on this machine, for use on another. A path is never sent
 * to a remote machine as this machine wrote it: each user's home differs,
 * so a path under this machine's home is sent `~/`-relative, which beam
 * resolves against the accepting machine's own home (beam docs/04). The
 * remote machine then reports the directory it actually found
 * (decisions.md D18).
 */

/** This machine's home as given and as resolved: a canonical path names
 *  the resolved one when the home is reached through a symlink. */
export function localHomes(home: string = homedir()): string[] {
  try {
    const real = realpathSync(home);
    return real === home ? [home] : [home, real];
  } catch {
    return [home];
  }
}

/** `path` in beam's `cwd` form for another machine: `~/`-relative under
 *  this machine's home, any other absolute path unchanged. A path already
 *  `~`-relative names the remote home and is kept. */
export function homeRelative(
  path: string,
  homes: readonly string[] = localHomes()
): string {
  if (path === '~' || path.startsWith('~/')) return path;
  for (const home of homes) {
    const rest = relative(home, path);
    if (rest === '') return '~/';
    if (rest !== '..' && !rest.startsWith('../') && !isAbsolute(rest))
      return `~/${rest}`;
  }
  return path;
}

/** `there` (beam's `cwd` form) as a path from the remote home. Commands
 *  run in that home, which always exists, so a missing directory is the
 *  command's own answer rather than a stream the far side refused. A
 *  refused or lost stream rejects, and reaches the caller as it is. */
function fromHome(there: string): string {
  if (there === '~' || there === '~/') return '.';
  return there.startsWith('~/') ? there.slice(2) : there;
}

const HOME = { cwd: '~' };

/** The far side's own words for a failure, or `fallback`. */
function farError(stderr: string, fallback: string): Error {
  return new Error(stderr.trim() || fallback);
}

/** The directory `path` (named on this machine) is on `executor`'s
 *  machine, as that machine resolves it. Throws naming the path it
 *  looked for when that machine cannot enter it. */
export async function directoryOnMachine(
  path: string,
  executor: MachineExecutor
): Promise<string> {
  const there = homeRelative(path);
  const { stdout, stderr, code } = await executor.run(
    ['sh', '-c', 'CDPATH= cd -P -- "$1" && pwd -P', 'sh', fromHome(there)],
    HOME
  );
  const resolved = stdout.trim();
  if (code === 0 && isAbsolute(resolved)) return resolved;
  // 126/127: no shell to ask, which says nothing about the directory.
  if (code >= 126) throw farError(stderr, `sh exited ${code}`);
  throw new Error(`Directory does not exist on that machine: ${there}`);
}

/** A worktree path template for `machine`: one under this machine's home
 *  moves under that machine's home; a relative one stays relative to the
 *  repository there. */
async function templateOnMachine(
  template: string | undefined,
  machine: Machine
): Promise<string | undefined> {
  if (!template || !isAbsolute(template)) return template;
  const there = homeRelative(template);
  if (!there.startsWith('~/')) return template;
  const home = await directoryOnMachine('~', machine.executor);
  return join(home, there.slice(2));
}

/** Git's answers that mean no clone is there: the directory is missing,
 *  or is not inside a repository. */
const NO_CLONE = /cannot change to|not a git repository/i;

/** The root of the clone at `there`, which must be the directory itself:
 *  Git answers for any enclosing repository (a dotfiles repository in
 *  the home, a monorepo above), and that is not this repository. */
async function cloneRoot(
  machine: Machine,
  there: string
): Promise<string | null> {
  const { stdout, stderr, code } = await machine.executor.run(
    [
      'git',
      '-C',
      fromHome(there),
      'rev-parse',
      '--show-toplevel',
      '--show-prefix',
    ],
    HOME
  );
  if (code !== 0) {
    if (NO_CLONE.test(stderr)) return null;
    throw farError(stderr, `git rev-parse exited ${code}`);
  }
  const [root = '', prefix] = stdout.split('\n');
  return prefix === '' && isAbsolute(root) ? root : null;
}

/**
 * The worktree scope of `repo`'s checkout on `machine`: the clone at the
 * same place under that machine's home (or the same absolute path, when
 * `repo` is outside this machine's home), its root as Git reports it there.
 */
export async function remoteWorktreeScope(
  repo: string,
  template: string | undefined,
  machine: Machine
): Promise<WorktreeScope> {
  const there = homeRelative(repo);
  const root = await cloneRoot(machine, there);
  if (!root)
    throw new Error(
      `No checkout of ${basename(
        repo
      )} at ${there} on that machine. Clone it there to launch on it.`
    );
  return worktreeScope(root, {
    template: await templateOnMachine(template, machine),
    machine,
  });
}
