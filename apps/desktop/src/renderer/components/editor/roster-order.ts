import type { Tab } from '../../lib/tabs/tabs.js';

/**
 * The rows of a group's roster, and how far each is indented. An
 * orchestrator's group lists its home first, and its players under it.
 * A tab working inside a player's worktree (its shell, its diff) sits
 * right after that player, one step further in. A group with no home
 * lists its players flat, each with its own tabs under it. A place
 * group's tabs have no player to sit under, so they stay flat.
 */
export interface RosterEntry<F extends { tab: Tab }> {
  face: F;
  depth: number;
}

/** The worktree a player's tab stands for. */
function playerRoot(tab: Tab): string | null {
  return tab.kind === 'item' ? tab.worktree ?? null : null;
}

/** Where a tab works: its worktree, or its terminal's directory. */
function workDir(tab: Tab): string | null {
  if (tab.kind === 'terminal') return tab.cwd;
  return playerRoot(tab);
}

const within = (dir: string, root: string) =>
  dir === root || dir.startsWith(`${root.replace(/\/+$/, '')}/`);

/** `faces` in strip order, `homeId`'s first when it is among them.
 *  `players`: the group is a parent's, whose worktree tabs are players. */
export function rosterEntries<F extends { tab: Tab }>(
  faces: readonly F[],
  homeId: string | undefined,
  players: boolean
): RosterEntry<F>[] {
  const home = faces.find((f) => f.tab.id === homeId);
  const rest = faces.filter((f) => f !== home);
  if (!players) return faces.map((face) => ({ face, depth: 0 }));
  const top = home ? 1 : 0;
  const roots = rest.filter((f) => playerRoot(f.tab) !== null);
  const playerOf = (face: F): F | undefined => {
    const dir = workDir(face.tab);
    if (dir === null || roots.includes(face)) return undefined;
    return roots.find((p) => within(dir, playerRoot(p.tab)!));
  };
  const under = new Map<F, F[]>();
  const tops: F[] = [];
  for (const face of rest) {
    const player = playerOf(face);
    if (player) under.set(player, [...(under.get(player) ?? []), face]);
    else tops.push(face);
  }
  return [
    ...(home ? [{ face: home, depth: 0 }] : []),
    ...tops.flatMap((face) => [
      { face, depth: top },
      ...(under.get(face) ?? []).map((f) => ({ face: f, depth: top + 1 })),
    ]),
  ];
}
