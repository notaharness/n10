import {
  homelessLabel,
  parentKey,
  placeAffiliation,
  placeLabel,
  type Affiliation,
  type SessionRef,
} from '../affiliation.js';
import { registryNameOf, type TaggedSession } from '../session-identity.js';
import { LOCAL_MACHINE } from '../session-key.js';

/**
 * What each listed session belongs to.
 *
 * - **Parent.** A session reports to the parent its
 *   `@session-x-orchestra-orchestrator` names, qualifier stripped
 *   (`parentKey`), so a parent is one group whether or not it runs in
 *   tmux.
 * - **Home.** The parent's own session: the one whose
 *   `@session-x-orchestra-target` is the key, or the session on this
 *   machine a `tmux:` key names. A home's own affiliation is the group
 *   it heads, keyed by its target (else `tmux:<name>`), so players
 *   naming it either way are one group. A marked orchestrator heads one
 *   with or without players. One that reports to another parent still
 *   heads its own, which `follows` that parent's.
 * - **Inheritance.** A terminal in a player's checkout takes the
 *   player's parent: it works beside it.
 * - **Place.** Everything else: the repository's main checkout for a
 *   worktree session, else what `placeOf` says of the directory (its
 *   repository's main checkout, or the directory itself).
 *
 * Repositories play no part in membership. Pure; the engine supplies the
 * listing and `placeOf`.
 */
export interface Affiliations {
  /** By registry key (`registryNameOf`): every listed session's. */
  sessions: ReadonlyMap<string, Affiliation>;
  /** A worktree session's checkout → its parent group, for what else
   *  works in that checkout (its row, its diff, a shell). Only checkouts
   *  whose agent reports to a parent. */
  worktrees: ReadonlyMap<string, Affiliation>;
}

export type PlaceOf = (dir: string, machine: string) => string;

const ref = (session: TaggedSession): SessionRef => ({
  key: registryNameOf(session),
  repo: session.repo,
  worktree: session.worktreePath,
});

/** The key a home's group goes by, however its players name it. */
const homeKey = (home: TaggedSession): string =>
  home.target ?? `tmux:${home.name}`;

function indexHomes(
  sessions: readonly TaggedSession[]
): Map<string, TaggedSession> {
  const homes = new Map<string, TaggedSession>();
  for (const session of sessions) {
    // A tmux name is only unique on its own server.
    if (session.machine === LOCAL_MACHINE) {
      const byName = `tmux:${session.name}`;
      if (!homes.has(byName)) homes.set(byName, session);
    }
    if (session.target && !homes.has(session.target))
      homes.set(session.target, session);
  }
  return homes;
}

interface Reporting {
  /** The group key the session reports to, canonical when a home is
   *  listed. */
  key: string;
  home?: TaggedSession;
}

function reportingOf(
  session: TaggedSession,
  homes: ReadonlyMap<string, TaggedSession>
): Reporting | null {
  if (!session.orchestrator) return null;
  const raw = parentKey(session.orchestrator);
  const home = homes.get(raw);
  if (home === session) return null;
  return home ? { key: homeKey(home), home } : { key: raw };
}

interface Context {
  reports: ReadonlyMap<TaggedSession, Reporting | null>;
  heads: ReadonlySet<TaggedSession>;
  placePath(session: TaggedSession): string;
  /** Each homeless parent's members' place labels. */
  homeless: ReadonlyMap<string, readonly string[]>;
}

function context(
  sessions: readonly TaggedSession[],
  placeOf: PlaceOf
): Context {
  const homes = indexHomes(sessions);
  const reports = new Map(
    sessions.map((s) => [s, reportingOf(s, homes)] as const)
  );
  const heads = new Set<TaggedSession>(
    sessions.filter((s) => s.target !== undefined)
  );
  for (const report of reports.values())
    if (report?.home) heads.add(report.home);
  const placePath = (s: TaggedSession) =>
    s.type === 'worktree' ? s.repo : placeOf(s.path, s.machine);
  const homeless = new Map<string, string[]>();
  for (const [session, report] of reports) {
    if (!report || report.home || heads.has(session)) continue;
    const places = homeless.get(report.key) ?? [];
    places.push(placeLabel(placePath(session)));
    homeless.set(report.key, places);
  }
  return { reports, heads, placePath, homeless };
}

/** The group a home heads. */
function headed(session: TaggedSession, report: Reporting | null): Affiliation {
  const key = homeKey(session);
  const follows = report && report.key !== key ? report.key : undefined;
  return {
    kind: 'parent',
    key,
    label: session.name,
    home: ref(session),
    ...(follows ? { follows } : {}),
  };
}

/** The parent a session has of its own, if any. */
function ownParent(session: TaggedSession, ctx: Context): Affiliation | null {
  const report = ctx.reports.get(session) ?? null;
  if (ctx.heads.has(session)) return headed(session, report);
  if (!report) return null;
  if (report.home)
    return {
      kind: 'parent',
      key: report.key,
      label: report.home.name,
      home: ref(report.home),
    };
  return {
    kind: 'parent',
    key: report.key,
    label: homelessLabel(report.key, ctx.homeless.get(report.key) ?? []),
  };
}

export function affiliations(
  sessions: readonly TaggedSession[],
  placeOf: PlaceOf
): Affiliations {
  const ctx = context(sessions, placeOf);
  const owned = new Map<TaggedSession, Affiliation>();
  const worktrees = new Map<string, Affiliation>();
  for (const session of sessions) {
    const parent = ownParent(session, ctx);
    if (!parent) continue;
    owned.set(session, parent);
    if (session.type === 'worktree' && session.worktreePath)
      worktrees.set(checkoutKey(session.worktreePath, session.machine), parent);
  }
  const inherited = (session: TaggedSession) =>
    session.type === 'worktree'
      ? undefined
      : worktrees.get(checkoutKey(session.path, session.machine));
  const result = new Map<string, Affiliation>();
  for (const session of sessions) {
    result.set(
      registryNameOf(session),
      owned.get(session) ??
        inherited(session) ??
        placeAffiliation(ctx.placePath(session), session.machine)
    );
  }
  return { sessions: result, worktrees };
}

/** A checkout on a machine, as `Affiliations.worktrees` keys it. */
export function checkoutKey(path: string, machine = LOCAL_MACHINE): string {
  const trimmed = path.replace(/[\\/]+$/, '') || path;
  return machine === LOCAL_MACHINE ? trimmed : `${machine}:${trimmed}`;
}
