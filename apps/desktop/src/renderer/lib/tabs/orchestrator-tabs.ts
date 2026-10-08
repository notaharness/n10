import type {
  OrchestraMemberSummary,
  OrchestratorGroupSummary,
} from '../../../host/contract.js';
import type { Tab } from './tab-identity.js';

/**
 * The strip's view of Orchestra's groups: which tab is an
 * orchestrator's, and which tabs are its players'. Membership is core's
 * (`orchestratorGroups`); this only finds each member's tab. Tabs
 * themselves are untouched — a player's tab opens, closes and activates
 * as any tab does; the strip shows it under its orchestrator's tab
 * instead of beside it.
 */
export interface OrchestratorTabs {
  /** Each orchestrator tab's player tabs, in strip order. Present, and
   *  possibly empty, for every tab whose session is an orchestrator. */
  players: ReadonlyMap<string, readonly Tab[]>;
  /** The tab ids the strip leaves out: shown under their orchestrator's
   *  tab instead. */
  grouped: ReadonlySet<string>;
  /** The orchestrator tab a grouped tab is shown under. */
  orchestratorOf: ReadonlyMap<string, string>;
}

export const NO_ORCHESTRATOR_TABS: OrchestratorTabs = {
  players: new Map(),
  grouped: new Set(),
  orchestratorOf: new Map(),
};

/** Whether `tab` is `member`'s: by session key, or, for a worktree
 *  session, by the repository and checkout a tab from another
 *  repository carries in place of a session key. */
function isMember(
  tab: Tab,
  member: OrchestraMemberSummary,
  sessionOf: (tab: Tab) => string | undefined
): boolean {
  if (sessionOf(tab) === member.key) return true;
  return (
    tab.kind === 'item' &&
    member.worktree !== '' &&
    tab.repo === member.repo &&
    tab.worktree === member.worktree
  );
}

export function orchestratorTabs(
  tabs: readonly Tab[],
  groups: readonly OrchestratorGroupSummary[],
  sessionOf: (tab: Tab) => string | undefined
): OrchestratorTabs {
  const tabOf = (member: OrchestraMemberSummary) =>
    tabs.find((tab) => isMember(tab, member, sessionOf));
  const homes = groups.flatMap((group) => {
    const home = tabOf(group.orchestrator);
    return home ? [{ home, group }] : [];
  });
  // An orchestrator that is another's player keeps its own place: under
  // its orchestrator, its players would be out of reach.
  const homeIds = new Set(homes.map(({ home }) => home.id));
  const players = new Map<string, Tab[]>();
  const orchestratorOf = new Map<string, string>();
  for (const { home, group } of homes) {
    const mine = tabs.filter(
      (tab) =>
        !homeIds.has(tab.id) &&
        !orchestratorOf.has(tab.id) &&
        group.players.some((p) => isMember(tab, p, sessionOf))
    );
    for (const tab of mine) orchestratorOf.set(tab.id, home.id);
    players.set(home.id, mine);
  }
  return { players, grouped: new Set(orchestratorOf.keys()), orchestratorOf };
}

/** The tabs the strip shows, in their order. */
export function stripTabs(
  tabs: readonly Tab[],
  grouping: OrchestratorTabs
): Tab[] {
  return tabs.filter((tab) => !grouping.grouped.has(tab.id));
}

/**
 * The order the strip presents every tab in: each tab it shows, an
 * orchestrator's followed by its player tabs. What positional keyboard
 * switching walks, so the selection never jumps back to an
 * orchestrator it already passed.
 */
export function presentedOrder(
  tabs: readonly Tab[],
  grouping: OrchestratorTabs
): string[] {
  return stripTabs(tabs, grouping).flatMap((tab) => [
    tab.id,
    ...(grouping.players.get(tab.id) ?? []).map((player) => player.id),
  ]);
}

/**
 * Which strip tab stands for the active tab — itself, or the
 * orchestrator tab a grouped player is shown under — and which tab is
 * the strip's one Tab stop: that one, else the first.
 */
export function stripSelection(
  strip: readonly Tab[],
  grouping: OrchestratorTabs,
  activeId: string | null
): { selectedId: string | null; tabStopId: string | undefined } {
  const standing = activeId
    ? grouping.orchestratorOf.get(activeId) ?? activeId
    : null;
  const selectedId = strip.some((t) => t.id === standing) ? standing : null;
  return { selectedId, tabStopId: selectedId ?? strip[0]?.id };
}

/** What an orchestrator's tab shows of its players, which the strip
 *  does not: one of them is the active tab, one opened in the
 *  background unseen, one finished a work streak nobody has looked at. */
export function playerMarks(
  players:
    | readonly {
        active: boolean;
        unseen: boolean;
        snapshot?: { flashing: boolean };
      }[]
    | undefined
): {
  active: boolean;
  unseen: boolean;
  flashing: boolean;
} {
  return {
    active: players?.some((p) => p.active) ?? false,
    unseen: players?.some((p) => p.unseen) ?? false,
    flashing: players?.some((p) => !p.active && p.snapshot?.flashing) ?? false,
  };
}
