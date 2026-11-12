import type { Tab } from './tab-identity.js';

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
  /** Tree guides, for an orchestrator's roster (none for a place's):
   *  `last`, the last row under its parent, where the guide turns a
   *  corner; `branches`, rows sit under it; `through`, for each level
   *  above the parent's, whether the guide there runs on past it. */
  tree?: { last: boolean; branches: boolean; through: boolean[] };
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
    // The innermost checkout: worktrees can sit inside another's.
    let best: F | undefined;
    for (const p of roots) {
      const root = playerRoot(p.tab)!;
      if (!within(dir, root)) continue;
      if (!best || root.length > playerRoot(best.tab)!.length) best = p;
    }
    return best;
  };
  const under = new Map<F, F[]>();
  const tops: F[] = [];
  for (const face of rest) {
    const player = playerOf(face);
    if (player) under.set(player, [...(under.get(player) ?? []), face]);
    else tops.push(face);
  }
  const homeRow = home && {
    face: home,
    depth: 0,
    tree: { last: true, branches: tops.length > 0, through: [] },
  };
  return [
    ...(homeRow ? [homeRow] : []),
    ...tops.flatMap((face, i) => {
      const last = i === tops.length - 1;
      const kids = under.get(face) ?? [];
      return [
        {
          face,
          depth: top,
          tree: { last, branches: kids.length > 0, through: [] },
        },
        ...kids.map((f, j) => ({
          face: f,
          depth: top + 1,
          tree: {
            last: j === kids.length - 1,
            branches: false,
            // Under the home, the home's guide runs on past a player
            // that is not its last.
            through: home ? [!last] : [],
          },
        })),
      ];
    }),
  ];
}
