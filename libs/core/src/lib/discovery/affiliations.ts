import {
  homelessLabel,
  parentTarget,
  placeAffiliation,
  placeLabel,
  tmuxKey,
  type Affiliation,
  type SessionRef,
} from '../affiliation.js';
import { registryNameOf, type TaggedSession } from '../session-identity.js';
import { LOCAL_MACHINE } from '../session-key.js';

/**
 * What each listed session belongs to.
 *
 * - **Parent.** A session reports to the parent its
 *   `@session-x-orchestra-orchestrator` names (`parentTarget`): a Claude
 *   or Codex parent is one group wherever it runs, a tmux one is a
 *   session on the qualifier's machine, else the reporter's own.
 * - **Home.** The parent's own session: the one whose
 *   `@session-x-orchestra-target` is the key, or the session a `tmux:`
 *   target names on its machine. A home's group is keyed by its target
 *   (else its `tmuxKey`), so players naming it either way are one group. A marked orchestrator heads one
 *   with or without players. One that reports to another parent still
 *   heads its own, which `follows` that parent's.
 * - **Inheritance.** A terminal in a player's checkout takes the
 *   player's parent: it works beside it.
 * - **Place.** Everything else: the repository's main checkout for a
 *   worktree session, else what `placeOf` says of the directory (its
 *   repository's main checkout, or the directory itself).
 *
 * Every member of a parent group carries the same affiliation, `follows`
 * included. Repositories play no part in membership. Pure; the engine supplies the
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

export interface AffiliationOptions {
  /** This machine's beam peerId: a qualifier naming it means here. */
  self?: string;
}

type Parent = Affiliation & { kind: 'parent' };

const ref = (session: TaggedSession): SessionRef => ({
  key: registryNameOf(session),
  repo: session.repo,
  worktree: session.worktreePath,
});

/** The key a home's group goes by, however its players name it. */
const homeKey = (home: TaggedSession): string =>
  home.target ?? tmuxKey(home.machine, home.name);

function indexHomes(
  sessions: readonly TaggedSession[]
): Map<string, TaggedSession> {
  const homes = new Map<string, TaggedSession>();
  for (const session of sessions) {
    // A tmux name is only unique on its own server.
    const byName = tmuxKey(session.machine, session.name);
    if (!homes.has(byName)) homes.set(byName, session);
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
  homes: ReadonlyMap<string, TaggedSession>,
  self: string | undefined
): Reporting | null {
  if (!session.orchestrator) return null;
  const { key } = parentTarget(session.orchestrator, session.machine, self);
  const home = homes.get(key);
  if (home === session) return null;
  return home ? { key: homeKey(home), home } : { key };
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
  placeOf: PlaceOf,
  self: string | undefined
): Context {
  const homes = indexHomes(sessions);
  const reports = new Map(
    sessions.map((s) => [s, reportingOf(s, homes, self)] as const)
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
function headed(session: TaggedSession, report: Reporting | null): Parent {
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

/** Every parent group, one object each, which all its members share. */
function groupsOf(
  sessions: readonly TaggedSession[],
  ctx: Context
): Map<string, Parent> {
  const groups = new Map<string, Parent>();
  for (const session of sessions) {
    if (!ctx.heads.has(session)) continue;
    const group = headed(session, ctx.reports.get(session) ?? null);
    if (!groups.has(group.key)) groups.set(group.key, group);
  }
  for (const [key, places] of ctx.homeless)
    groups.set(key, { kind: 'parent', key, label: homelessLabel(key, places) });
  return groups;
}

/** The parent group a session belongs to of its own, if any. */
function ownParent(
  session: TaggedSession,
  ctx: Context,
  groups: ReadonlyMap<string, Parent>
): Parent | undefined {
  if (ctx.heads.has(session)) return groups.get(homeKey(session));
  const report = ctx.reports.get(session);
  return report ? groups.get(report.key) : undefined;
}

export function affiliations(
  sessions: readonly TaggedSession[],
  placeOf: PlaceOf,
  options: AffiliationOptions = {}
): Affiliations {
  const ctx = context(sessions, placeOf, options.self);
  const groups = groupsOf(sessions, ctx);
  const owned = new Map<TaggedSession, Affiliation>();
  const worktrees = new Map<string, Affiliation>();
  for (const session of sessions) {
    const parent = ownParent(session, ctx, groups);
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
