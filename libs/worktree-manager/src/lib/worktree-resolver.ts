/** Immutable path policy captured by one repository operation. */
import { resolve } from 'node:path';
import { branchToSessionName } from './refs.js';
import type { Machine } from './machine.js';

export interface WorktreeResolver {
  dir(branch: string): string;
  owns(absolutePath: string): boolean;
  base(): string;
}

export interface WorktreeScope {
  readonly cwd: string;
  readonly resolver: WorktreeResolver;
  readonly machine?: Machine;
}

/**
 * Put a path into the form `owns()` compares in.
 *
 * On Windows the two sides arrive in different shapes: `path.resolve`
 * produces backslashes (`C:\repo\.claude\worktrees`) while
 * `git worktree list --porcelain` reports forward slashes
 * (`C:/repo/.claude/worktrees/foo`), so a literal comparison never
 * matches and every worktree looks unowned. Case is folded too, since
 * the same checkout can be reported under either drive-letter case.
 *
 * Off Windows this is the identity function, deliberately: `\` is a
 * legal character in a POSIX directory name, so rewriting separators
 * there could make two genuinely distinct paths compare equal, and
 * POSIX paths are case-sensitive.
 */
const normalizePath = (p: string): string =>
  process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p;

/** Shared membership test: is `p` the base directory or inside it? */
const isUnder = (p: string, baseDir: string): boolean => {
  const base = normalizePath(baseDir);
  const target = normalizePath(p);
  return target === base || target.startsWith(base + '/');
};

export function createTemplateResolver(
  template: string,
  cwd: string
): WorktreeResolver {
  const baseTemplate =
    template.replace(/\/?\{(?:branch|session)\}.*$/, '') || '.';
  const base = resolve(cwd, baseTemplate);
  return {
    dir: (branch) =>
      template
        .replace('{branch}', branch)
        .replace('{session}', branchToSessionName(branch)),
    owns: (path) => isUnder(path, base),
    base: () => base,
  };
}

/** Capture path policy before awaiting Git; no process-wide selected resolver. */
export function worktreeScope(
  cwd: string,
  options: { template?: string; machine?: Machine } = {}
): WorktreeScope {
  return {
    cwd,
    resolver: createTemplateResolver(
      options.template ?? '.claude/worktrees/{session}',
      cwd
    ),
    ...(options.machine ? { machine: options.machine } : {}),
  };
}
