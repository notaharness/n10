import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import {
  useForeignSessions,
  useSessions,
  useTerminals,
} from '../../lib/data/queries.js';
import { useRepo } from '../../lib/repo-context.js';
import { affiliationIndex, tabFacts } from '../../lib/tabs/tab-affiliation.js';
import { isHomeTab, type TabFacts } from '../../lib/tabs/tab-groups.js';
import { indexItems } from '../../lib/tabs/tab-item.js';
import { listedSessions, tabSessions } from '../../lib/tabs/tab-sessions.js';
import type { Tab } from '../../lib/tabs/tabs.js';

/** Shared grouping facts for a pane's strip and workspace placement. */
export function useTabFacts(items: SidebarItem[]) {
  const { repo } = useRepo();
  const terminals = useTerminals();
  const foreign = useForeignSessions();
  const sessions = useSessions(repo.cwd);
  const index = useMemo(() => indexItems(repo.cwd, items), [repo.cwd, items]);
  const sessionRows = useMemo(
    () => listedSessions(items, sessions.data),
    [items, sessions.data]
  );
  const affiliations = useMemo(
    () =>
      affiliationIndex({
        repo: repo.cwd,
        sessions: sessionRows,
        terminals: terminals.data ?? [],
        foreign: foreign.data?.sessions ?? [],
      }),
    [repo.cwd, sessionRows, terminals.data, foreign.data]
  );
  const { sessionOf, ownSession } = tabSessions(items, index);
  const factsOf = (tab: Tab) => tabFacts(tab, sessionOf(tab), affiliations);
  return { index, sessionOf, ownSession, factsOf };
}

/** Whether a tab is its parent group's orchestrator. */
export function isHomeIn(tab: Tab, facts: TabFacts): boolean {
  const a = facts.affiliation;
  return a?.kind === 'parent' && !!a.home && isHomeTab(tab, facts, a.home);
}

/** Stable callbacks for workspace sync, reading the latest listing. */
export function useGrouping(items: SidebarItem[]) {
  const { factsOf } = useTabFacts(items);
  const latest = useRef(factsOf);
  useEffect(() => {
    latest.current = factsOf;
  });
  const groupOf = useCallback(
    (tab: Tab) => latest.current(tab).affiliation?.key ?? null,
    []
  );
  const isHome = useCallback(
    (tab: Tab) => isHomeIn(tab, latest.current(tab)),
    []
  );
  return useMemo(() => ({ groupOf, isHome }), [groupOf, isHome]);
}
