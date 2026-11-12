import type { SidebarItem } from '../../../host/contract.js';
import { itemBranch, itemSessionName } from '../sidebar/sidebar-model.js';
import type { Tab } from './tab-identity.js';
import { tabItem, type ItemIndex } from './tab-item.js';

/** Which session a tab is about, from the open repository's items. */
export interface TabSessions {
  /** The session a tab shows or works beside: a terminal's own, its
   *  row's agent, else the agent in a checkout on the item's branch. */
  sessionOf(tab: Tab): string | undefined;
  /** The one whose state is the tab's own: a terminal's, or its row's
   *  agent (a review's too, whose checkout's row the review is), not
   *  one on the same branch elsewhere. */
  ownSession(tab: Tab): string | undefined;
}

export function tabSessions(
  items: readonly SidebarItem[],
  index: ItemIndex
): TabSessions {
  const ownSession = (tab: Tab): string | undefined => {
    if (tab.kind === 'terminal') return tab.name;
    const item = tabItem(tab, index);
    return item && itemSessionName(item);
  };
  const sessionOf = (tab: Tab): string | undefined => {
    const own = ownSession(tab);
    if (own) return own;
    const item = tabItem(tab, index);
    if (!item) return undefined;
    const branch = itemBranch(item);
    for (const i of items) {
      const name = itemSessionName(i);
      if (name && itemBranch(i) === branch) return name;
    }
    return undefined;
  };
  return { sessionOf, ownSession };
}

/** The session rows a repository's affiliations are read from: its
 *  sidebar's, and every agent the engine lists for it, a review
 *  checkout's included, whose worktree row the sidebar folds into its
 *  pull request's. */
export function listedSessions<S extends { name: string }>(
  items: readonly SidebarItem[],
  listed: readonly S[] | undefined
): (S | Extract<SidebarItem, { kind: 'session' }>['session'])[] {
  return [
    ...items.flatMap((i) => (i.kind === 'session' ? [i.session] : [])),
    ...(listed ?? []),
  ];
}
