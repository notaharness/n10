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
