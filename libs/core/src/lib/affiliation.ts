/**
 * What a session, or a tab, belongs to: the parent it reports to, else
 * its place. Derived, never stored. Browser-safe: the desktop renderer
 * derives a place for a tab no session describes with these same keys.
 * `discovery/affiliations.ts` derives a listing's.
 */

/** A session as the tabs that can show it carry it: its registry key,
 *  and for a worktree session its main checkout and checkout (`''` for
 *  a terminal), which a tab from another repository is stamped with. */
export interface SessionRef {
  key: string;
  repo: string;
  worktree: string;
}

export type Affiliation =
  | {
      kind: 'parent';
      /** The parent's reporting target with any `beam:<peer>/`
       *  qualifier stripped (`claude:<id>`, `codex:<id>`,
       *  `tmux:<session>`): one group whether or not, and wherever, the
       *  parent runs. */
      key: string;
      label: string;
      /** The parent's own session, when this machine's view lists it. */
      home?: SessionRef;
      /** On a group whose home reports to another parent: that
       *  parent's key. The group is shown right after that one; groups
       *  never nest. */
      follows?: string;
    }
  | { kind: 'place'; key: string; label: string };

const BEAM_QUALIFIER = /^beam:[^/]+\//;

/** A reporting target without its transport qualifier. */
export function parentKey(target: string): string {
  return target.replace(BEAM_QUALIFIER, '');
}

/** The key of a place: a repository's main checkout, or a directory,
 *  on a machine (`'local'` or a beam peerId). */
export function placeKey(path: string, machine = 'local'): string {
  return machine === 'local' ? `place:${path}` : `place:${machine}:${path}`;
}

/** The last segment of a path: what a place goes by on screen. */
export function placeLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function placeAffiliation(
  path: string,
  machine = 'local'
): Affiliation & { kind: 'place' } {
  return {
    kind: 'place',
    key: placeKey(path, machine),
    label: placeLabel(path),
  };
}

const HARNESS_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

/**
 * What a parent no session here answers to is called: its harness and
 * its members' common place (`Codex · skolakerfi`), the harness alone
 * when they work in several. A `tmux:` key names its session.
 */
export function homelessLabel(
  key: string,
  memberPlaces: readonly string[]
): string {
  const colon = key.indexOf(':');
  const scheme = colon < 0 ? key : key.slice(0, colon);
  if (scheme === 'tmux') return key.slice(colon + 1);
  const harness = HARNESS_LABELS[scheme] ?? scheme;
  const places = new Set(memberPlaces);
  const [only] = places;
  return places.size === 1 && only ? `${harness} · ${only}` : harness;
}
