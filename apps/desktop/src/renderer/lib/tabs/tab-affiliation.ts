import { placeAffiliation, type Affiliation } from '@n10/core/ui';
import type { TabFacts } from './tab-groups.js';
import type { Tab } from './tab-identity.js';

/**
 * Where a tab's affiliation comes from: the engine stamps one on every
 * session row, terminal and foreign agent it lists (`affiliation`), and
 * a tab takes its session's. A tab no listing describes yet, or with no
 * session (a pull request, a branch without an agent), belongs to its
 * place: its repository, else its directory.
 */
export interface AffiliationIndex {
  /** By registry key. */
  bySession: ReadonlyMap<string, Affiliation>;
  /** By checkout, as `checkoutId(repo, worktree)`. */
  byCheckout: ReadonlyMap<string, Affiliation>;
}

const checkoutId = (repo: string, worktree: string) => `${repo}\0${worktree}`;

export function affiliationIndex(sources: {
  /** The open repository's session rows. */
  repo: string;
  sessions: readonly {
    name: string;
    path?: string;
    affiliation?: Affiliation;
  }[];
  terminals: readonly { name: string; affiliation?: Affiliation }[];
  foreign: readonly {
    sessionName: string;
    repo: string;
    worktree: string;
    affiliation?: Affiliation;
  }[];
}): AffiliationIndex {
  const bySession = new Map<string, Affiliation>();
  const byCheckout = new Map<string, Affiliation>();
  for (const s of sources.sessions) {
    if (!s.affiliation) continue;
    bySession.set(s.name, s.affiliation);
    if (s.path) byCheckout.set(checkoutId(sources.repo, s.path), s.affiliation);
  }
  for (const t of sources.terminals)
    if (t.affiliation) bySession.set(t.name, t.affiliation);
  for (const f of sources.foreign) {
    if (!f.affiliation) continue;
    bySession.set(f.sessionName, f.affiliation);
    byCheckout.set(checkoutId(f.repo, f.worktree), f.affiliation);
  }
  return { bySession, byCheckout };
}

/** What the strip groups `tab` by. `session` is the session the tab
 *  shows or works beside, if the caller knows one. */
export function tabFacts(
  tab: Tab,
  session: string | undefined,
  index: AffiliationIndex
): TabFacts {
  if (tab.kind === 'settings') return { affiliation: null };
  const own = session === undefined ? undefined : index.bySession.get(session);
  const byCheckout =
    tab.kind === 'item' && tab.worktree
      ? index.byCheckout.get(checkoutId(tab.repo, tab.worktree))
      : undefined;
  const place =
    tab.kind === 'item'
      ? placeAffiliation(tab.repo)
      : placeAffiliation(tab.repo ?? tab.cwd);
  return {
    affiliation: own ?? byCheckout ?? place,
    ...(session === undefined ? {} : { session }),
  };
}
