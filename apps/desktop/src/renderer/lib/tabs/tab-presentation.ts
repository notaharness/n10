import type { SidebarItem } from '../../../host/contract.js';
import { itemBranch } from '../sidebar/sidebar-model.js';
import type { CutSide } from './label-cut.js';
import type { Tab } from './tab-identity.js';
import type { TabGroup } from './tab-groups.js';

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
export type LabelSource =
  | 'settings'
  | 'pr'
  | 'task'
  | 'branch'
  | 'dir'
  | 'place';

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
  machineLabel?: string | null,
  context: {
    chipped?: boolean;
    taskTitle?: string;
    branch?: string;
    place?: string;
  } = {}
): {
  label: string;
  face: TabFace;
  source: LabelSource;
  prefix: string;
  base: string;
} {
  const base = basePresentation(tab, item, context);
  if (tab.kind === 'settings') return { ...base, prefix: '', base: base.label };
  const path = tab.kind === 'item' ? tab.repo : tab.repo ?? tab.cwd;
  const place = context.place ?? placeFor(tab, path);
  const samePlace = base.label.toLowerCase() === placeName(place).toLowerCase();
  const placePrefix = context.chipped || samePlace ? '' : `${place} · `;
  const machinePrefix = machineLabel ? `${machineLabel} · ` : '';
  const prefix = machinePrefix + placePrefix;
  const shownBase = samePlace && !context.chipped ? place : base.label;
  const label = prefix + shownBase;
  return {
    ...base,
    label,
    prefix,
    base: shownBase,
  };
}

function placeFor(tab: Tab, path: string): string {
  if (path) return placeName(path);
  return tab.kind === 'terminal' && tab.terminalKind === 'agent'
    ? 'Agent'
    : 'Terminal';
}

function basePresentation(
  tab: Tab,
  item: SidebarItem | undefined,
  context: { taskTitle?: string; branch?: string }
): { label: string; face: TabFace; source: LabelSource } {
  if (tab.kind === 'settings')
    return { label: 'Settings', face: 'settings', source: 'settings' };
  if (tab.kind === 'terminal') return terminalPresentation(tab, context);
  return itemPresentation(tab, item, context.taskTitle);
}

function terminalPresentation(
  tab: Extract<Tab, { kind: 'terminal' }>,
  context: { taskTitle?: string; branch?: string }
): { label: string; face: TabFace; source: LabelSource } {
  const source =
    tab.terminalKind === 'agent' && context.taskTitle
      ? 'task'
      : tab.terminalKind === 'agent' && context.branch
      ? 'branch'
      : 'dir';
  return { label: terminalLabel(tab, context), face: 'terminal', source };
}

function itemPresentation(
  tab: Extract<Tab, { kind: 'item' }>,
  item: SidebarItem | undefined,
  taskTitle?: string
): { label: string; face: TabFace; source: LabelSource } {
  const isPr = item ? Boolean(item.pr) : tab.itemKey.startsWith('pr:');
  const label = isPr ? prLabel(tab, item) : branchLabel(tab, item, taskTitle);
  const source = isPr
    ? 'pr'
    : taskTitle
    ? 'task'
    : tab.branch || (item && itemBranch(item))
    ? 'branch'
    : 'dir';
  return { label, face: isPr ? 'pr' : 'branch', source };
}

function terminalLabel(
  tab: Extract<Tab, { kind: 'terminal' }>,
  context: { taskTitle?: string; branch?: string }
): string {
  if (tab.terminalKind === 'shell') return placeName(tab.cwd);
  return (
    context.taskTitle ??
    context.branch ??
    (tab.cwd ? placeName(tab.cwd) : 'Agent')
  );
}

function prLabel(
  tab: Extract<Tab, { kind: 'item' }>,
  item: SidebarItem | undefined
): string {
  return (
    item?.pr?.title ?? tab.title ?? `PR #${tab.itemKey.replace(/^pr:/, '')}`
  );
}

function branchLabel(
  tab: Extract<Tab, { kind: 'item' }>,
  item: SidebarItem | undefined,
  taskTitle?: string
): string {
  return (
    taskTitle ??
    (item ? itemBranch(item) : undefined) ??
    tab.branch ??
    (tab.worktree ? placeName(tab.worktree) : placeName(tab.repo))
  );
}

/** Directory basename, with meaningful names for the filesystem roots. */
export function placeName(path: string): string {
  if (!path) return 'Terminal';
  if (
    path === '~' ||
    path === '/root' ||
    /^\/(?:home|Users)\/[^/]+\/?$/.test(path) ||
    /^[A-Za-z]:\\Users\\[^\\]+\\?$/i.test(path)
  )
    return 'Home';
  if (path === '/') return 'Root';
  const parts = path.split(/[\\/]/).filter(Boolean);
  const last = parts.at(-1);
  return last ?? 'Home';
}

/** Canonical place carried by discovery; a tab-only group uses its one place. */
export function groupPlacePath(group: TabGroup): string | undefined {
  const known =
    group.affiliation?.place ??
    (group.affiliation?.kind === 'parent'
      ? group.affiliation.home?.place
      : undefined);
  if (known) return known;
  const paths = new Set(
    group.tabs.flatMap((tab) =>
      tab.kind === 'item'
        ? [tab.repo]
        : tab.kind === 'terminal'
        ? [tab.repo ?? tab.cwd]
        : []
    )
  );
  return paths.size === 1 ? [...paths][0] : undefined;
}

/** Resolve equal full labels in their presented group before cutting text. */
export function collisionLabel(
  tab: Tab,
  peers: readonly Tab[],
  labelOf: (tab: Tab) => string,
  openedIds: readonly string[],
  ordinalOf: (
    id: string
  ) => { base: string; ordinal: number } | undefined = () => undefined,
  branchOf: (tab: Tab) => string | undefined = () => undefined
): { label: string; ordinal?: number } {
  const base = labelOf(tab);
  const canonical = canonicalLabel;
  const same = peers.filter(
    (peer) => canonical(labelOf(peer)) === canonical(base)
  );
  if (same.length < 2) return { label: base };
  const primary = same.map((peer) => primaryDiscriminator(peer, branchOf));
  if (distinct(primary))
    return { label: `${base} · ${primaryDiscriminator(tab, branchOf)}` };
  const paths = same.map(tabPath);
  if (paths.every(Boolean) && new Set(paths).size === same.length) {
    const suffixes = shortestSuffixes(paths as string[]);
    const suffix = suffixes[same.findIndex((peer) => peer.id === tab.id)];
    if (suffix && !base.endsWith(suffix))
      return { label: `${base} · ${suffix}` };
  }
  const ordinal = availableOrdinal(tab, same, openedIds, labelOf, ordinalOf);
  return { label: `${base} · ${ordinal}`, ordinal };
}

function canonicalLabel(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function availableOrdinal(
  tab: Tab,
  peers: readonly Tab[],
  openedIds: readonly string[],
  labelOf: (tab: Tab) => string,
  ordinalOf: (id: string) => { base: string; ordinal: number } | undefined
): number {
  const base = canonicalLabel(labelOf(tab));
  const valid = (peer: Tab) => {
    const held = ordinalOf(peer.id);
    return held && canonicalLabel(held.base) === base
      ? held.ordinal
      : undefined;
  };
  const used = new Set(
    peers.map(valid).filter((n): n is number => n !== undefined)
  );
  const ordered = [...peers].sort(
    (a, b) => openedIds.indexOf(a.id) - openedIds.indexOf(b.id)
  );
  let next = 1;
  for (const peer of ordered) {
    if (valid(peer)) {
      if (peer.id === tab.id) return valid(peer)!;
      continue;
    }
    while (used.has(next)) next++;
    if (peer.id === tab.id) return next;
    used.add(next++);
  }
  return next;
}

function distinct(values: (string | undefined)[]): boolean {
  return values.every(Boolean) && new Set(values).size === values.length;
}

function primaryDiscriminator(
  tab: Tab,
  branchOf: (tab: Tab) => string | undefined
): string | undefined {
  if (tab.kind === 'settings') return undefined;
  if (tab.kind === 'terminal')
    return tab.terminalKind === 'agent' ? branchOf(tab) ?? 'Agent' : 'Shell';
  return tab.itemKey.startsWith('pr:')
    ? `#${tab.itemKey.slice(3)}`
    : tab.branch;
}

function tabPath(tab: Tab): string | undefined {
  return tab.kind === 'item'
    ? tab.worktree
    : tab.kind === 'terminal'
    ? tab.cwd
    : undefined;
}

function shortestSuffixes(paths: readonly string[]): string[] {
  const parts = paths.map((path) => path.split(/[\\/]/).filter(Boolean));
  for (
    let depth = 1;
    depth <= Math.max(...parts.map((p) => p.length));
    depth++
  ) {
    const suffixes = parts.map((p) => p.slice(-depth).join('/'));
    if (new Set(suffixes).size === paths.length) return suffixes;
  }
  return [...paths];
}

/** Distinguish equal place basenames using only the needed parent components. */
export function placeLabels(
  paths: readonly string[]
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const path of new Set(paths)) labels.set(path, placeName(path));
  for (const path of labels.keys()) {
    const siblings = [...labels.keys()].filter(
      (candidate) => placeName(candidate) === placeName(path)
    );
    if (siblings.length < 2) continue;
    const names = shortestSuffixes(siblings);
    for (let at = 0; at < siblings.length; at++)
      labels.set(siblings[at]!, names[at]!);
  }
  return labels;
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
