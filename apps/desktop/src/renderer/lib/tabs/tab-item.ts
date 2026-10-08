import type { SidebarItem } from '../../../host/contract.js';
import { itemBranch, itemKey, itemWorktree } from '../sidebar/sidebar-model.js';
import type { Tab } from './tabs-model.js';

/** A repository's sidebar rows, looked up the three ways a tab names
 *  its row. */
export interface ItemIndex {
  repo: string;
  byKey: ReadonlyMap<string, SidebarItem>;
  byBranch: ReadonlyMap<string, SidebarItem>;
  byWorktree: ReadonlyMap<string, SidebarItem>;
}

export function indexItems(
  repo: string,
  items: readonly SidebarItem[]
): ItemIndex {
  return {
    repo,
    byKey: new Map(items.map((i) => [itemKey(i), i])),
    byBranch: new Map(items.map((i) => [itemBranch(i), i])),
    byWorktree: new Map(
      items.flatMap((i) => {
        const worktree = itemWorktree(i);
        return worktree ? [[worktree, i] as const] : [];
      })
    ),
  };
}

/**
 * The sidebar item a tab is showing, among its own repository's rows.
 *
 * Falls back to the tab's stamped branch when its key doesn't resolve:
 * an item re-keys the moment a PR appears (`branch:x` → `pr:42`), and
 * `sync-items` only catches up in an effect — one render happens
 * first. Looking up by key alone would make that render treat the tab
 * as itemless, which swaps the pane out and remounts a live agent's
 * terminal under the user twice over a PR's life. The worktree is asked
 * first, for the same reason: `git switch` inside it moves its item to
 * another key, and can leave its old PR behind under the old one.
 *
 * A tab of another repository resolves to nothing here: a shared branch
 * name would otherwise hand that tab this repository's worktree, its
 * agent and its diff.
 */
export function tabItem(tab: Tab, index: ItemIndex): SidebarItem | undefined {
  if (tab.kind !== 'item' || tab.repo !== index.repo) return undefined;
  return (
    (tab.worktree ? index.byWorktree.get(tab.worktree) : undefined) ??
    index.byKey.get(tab.itemKey) ??
    (tab.branch ? index.byBranch.get(tab.branch) : undefined)
  );
}
