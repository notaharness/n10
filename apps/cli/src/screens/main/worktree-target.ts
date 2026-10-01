import type { SidebarItem } from '@n10/core';
import type { WorktreeTarget } from '@n10/engine';

/** Translate the selected row into the engine’s stable checkout/branch identity. */
export function worktreeTarget(item: SidebarItem): WorktreeTarget {
  return item.kind === 'session'
    ? { session: item.session.name }
    : { branch: item.pr.sourceBranch };
}
