import { isDeepStrictEqual } from 'node:util';
import {
  affiliations,
  checkoutKey,
  LOCAL_MACHINE,
  mainCheckoutOf,
  type Affiliation,
  type Affiliations,
  type PlaceOf,
  type TaggedSession,
} from '@n10/core';
import { logError } from '@n10/logger';

export type AffiliationService = ReturnType<typeof createAffiliationService>;

const EMPTY: Affiliations = { sessions: new Map(), worktrees: new Map() };

/**
 * What every session the engine sees belongs to (core's
 * `affiliations`), over the last listing of each machine together: a
 * remote player joins its orchestrator's group when both are listed.
 * Process-wide, because groups span repositories. Fed by discovery's
 * scans, which list tmux anyway; the session and terminal services stamp
 * its answers onto their rows. Orchestra tags a player without any
 * event, so a change shows at the next scan.
 */
export function createAffiliationService(options: { placeOf?: PlaceOf } = {}) {
  const listings = new Map<string, readonly TaggedSession[]>();
  const places = new Map<string, string>();
  let snapshot = EMPTY;
  const listeners = new Set<() => void>();

  /** A local directory's repository main checkout, else itself; asked of
   *  Git once per directory while it is listed. Another machine's
   *  directory cannot be asked from here and stays as it is. */
  const defaultPlaceOf: PlaceOf = (dir, machine) => {
    if (machine !== LOCAL_MACHINE) return dir;
    let place = places.get(dir);
    if (place === undefined) {
      place = mainCheckoutOf(dir) ?? dir;
      places.set(dir, place);
    }
    return place;
  };
  const placeOf = options.placeOf ?? defaultPlaceOf;

  function forgetUnlisted(): void {
    const listed = new Set(listings.get(LOCAL_MACHINE)?.map((s) => s.path));
    for (const dir of places.keys()) if (!listed.has(dir)) places.delete(dir);
  }

  function observe(machine: string, sessions: readonly TaggedSession[]): void {
    listings.set(machine, sessions);
    if (machine === LOCAL_MACHINE) forgetUnlisted();
    const next = affiliations([...listings.values()].flat(), placeOf);
    if (isDeepStrictEqual(next, snapshot)) return;
    snapshot = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        logError('affiliation observer', error);
      }
    }
  }

  return {
    observe,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A session's, by registry key, once a listing has named it. */
    of(key: string): Affiliation | undefined {
      return snapshot.sessions.get(key);
    },
    /** The parent group of the agent working in a checkout, if any. */
    ofCheckout(path: string, machine = LOCAL_MACHINE): Affiliation | undefined {
      return snapshot.worktrees.get(checkoutKey(path, machine));
    },
  };
}
