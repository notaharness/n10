import { worktreeScope } from '@n10/worktree-manager';
import { readConfig } from '@n10/vcs-core';

/** Capture a repository’s current path policy for a standalone core operation. */
export function repositoryWorktreeScope(repo: string) {
  return worktreeScope(repo, { template: readConfig(repo).worktreePath });
}
