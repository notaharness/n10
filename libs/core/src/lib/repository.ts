import { realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTemplateResolver,
  resetWorktreeResolver,
  setWorktreeResolver,
} from '@n10/worktree-manager';

/** Worktrees and submodules have a .git file; main checkouts have a directory. */
export function isGitRepo(cwd: string): boolean {
  try {
    const entry = statSync(join(cwd, '.git'));
    return entry.isDirectory() || entry.isFile();
  } catch {
    return false;
  }
}

export function canonicalRepoPath(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

export function configureWorktreePath(cwd: string, template?: string): void {
  if (template) setWorktreeResolver(createTemplateResolver(template, cwd));
  else resetWorktreeResolver();
}
