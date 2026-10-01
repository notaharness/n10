import type { SidebarItem } from '../../../host/contract.js';
import { itemTitle } from '../sidebar/sidebar-model.js';
import type { CutSide } from './label-cut.js';
import type { Tab } from './tab-identity.js';

/**
 * How the strip presents a set of tabs that spans repositories.
 *
 * Pure, and separate from the strip itself: what reads as "these two
 * tabs belong to different repos" is a property of the sequence, not of
 * either tab, and getting it from a component means recomputing it per
 * tab from the neighbour's props.
 */

/** What a tab is a tab of, as far as its icon is concerned. */
export type TabFace = 'settings' | 'pr' | 'branch' | 'terminal';

/**
 * Which end a label too long for its tab loses. A branch name or a
 * directory is told from its neighbours by its end (`…/tab-strip-wrap`,
 * `…/Code/n10`), so it loses its start; a pull request's title, and
 * anything else, reads from its start and loses its end.
 */
export function cutSide(face: TabFace): CutSide {
  return face === 'branch' || face === 'terminal' ? 'start' : 'end';
}

/**
 * What a tab shows for itself.
 *
 * The item is the live answer, and is preferred: its title follows the
 * pull request as it is renamed. A tab whose item is out of reach — its
 * repository is not the open one, so this sidebar has no row for it —
 * shows the title it was last stamped with, then its branch, and only
 * then the bare key, so a tab never turns back into a slug because the
 * user looked at another repository.
 */
/**
 * `machineLabel`, resolved by the caller (never a peerId — meaning
 * nothing to the user), is `null` for a local tab and omitted from the
 * title entirely: D8 says a user who never pairs anything sees today's
 * tab strip exactly. For a remote one, the machine comes first —
 * `workbox · feature/x` — because when scanning tabs spanning several
 * machines, the machine is the disambiguator (ux-machines.md §6).
 */
export function tabPresentation(
  tab: Tab,
  item: SidebarItem | undefined,
  machineLabel?: string | null
): { label: string; face: TabFace } {
  const base = basePresentation(tab, item);
  if (!machineLabel || tab.kind === 'settings') return base;
  return { ...base, label: `${machineLabel} · ${base.label}` };
}

function basePresentation(
  tab: Tab,
  item: SidebarItem | undefined
): { label: string; face: TabFace } {
  if (tab.kind === 'settings') return { label: 'Settings', face: 'settings' };
  if (tab.kind === 'terminal') {
    return { label: tab.displayPath, face: 'terminal' };
  }
  const label =
    (item ? itemTitle(item) : undefined) ??
    tab.title ??
    tab.branch ??
    tab.itemKey.replace(/^[a-z]+:/, '');
  const isPr = item ? Boolean(item.pr) : tab.itemKey.startsWith('pr:');
  return { label, face: isPr ? 'pr' : 'branch' };
}

/** The repository a tab belongs to, or null for a repo-agnostic tab. */
export function tabRepo(tab: Tab): string | null {
  return tab.kind === 'settings' ? null : tab.repo;
}

/** The short name a repository goes by on screen: its directory name. */
export function repoDisplayName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}
