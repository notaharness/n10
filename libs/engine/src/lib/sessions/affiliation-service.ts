import { isDeepStrictEqual } from 'node:util';
import {
  affiliations,
  checkoutKey,
  LOCAL_MACHINE,
  mainCheckoutOf,
  placeAffiliation,
  type Affiliation,
  type Affiliations,
  type PlaceOf,
  type TaggedSession,
} from '@n10/core';
import { logError } from '@n10/logger';

/** What the service reads of a fleet row (`MachineView`). */
export interface FleetMember {
  peerId: string;
  isLocal: boolean;
  state: string;
}

const gone = (m: FleetMember) =>
  m.state === 'revoked' || m.state === 'revoked-by-fleet';

export type AffiliationService = ReturnType<typeof createAffiliationService>;

const EMPTY: Affiliations = { sessions: new Map(), worktrees: new Map() };

/**
 * What every session the engine sees belongs to (core's
 * `affiliations`), over the last listing of each machine together: a
 * remote player joins its orchestrator's group when both are listed.
 * Process-wide, because groups span repositories. Fed by discovery's
 * scans, which list tmux anyway; the session and terminal services stamp
 * its answers onto their rows. Orchestra tags a player without any
 * event, so a change shows at the next scan. The fleet says which peerId
 * is this machine (a `tmux:` target qualified with it means here) and
 * which peers are gone (`observeFleet`); a peer that is only unreachable
 * keeps its last listing until it is listed again.
 */
export function createAffiliationService(options: { placeOf?: PlaceOf } = {}) {
  const listings = new Map<string, readonly TaggedSession[]>();
  const places = new Map<string, string>();
  let self: string | undefined;
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
  /** A terminal's launch directory's place, asked on every listing of
   *  terminals; kept apart from the listings' memo, which forgets what
   *  no pane shows. Terminals are few. */
  const launched = new Map<string, string>();
  const launchPlaceOf: PlaceOf = (dir, machine) => {
    const key = `${machine}\0${dir}`;
    let place = launched.get(key);
    if (place === undefined) {
      place = placeOf(dir, machine);
      launched.set(key, place);
    }
    return place;
  };

  function forgetUnlisted(): void {
    const listed = new Set(listings.get(LOCAL_MACHINE)?.map((s) => s.path));
    for (const dir of places.keys()) if (!listed.has(dir)) places.delete(dir);
  }

  function derive(): void {
    const next = affiliations([...listings.values()].flat(), placeOf, {
      self,
    });
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

  function observe(machine: string, sessions: readonly TaggedSession[]): void {
    listings.set(machine, sessions);
    if (machine === LOCAL_MACHINE) forgetUnlisted();
    derive();
  }

  /** The fleet's rows: this machine's peerId, and the peers no longer in
   *  it (absent from a listing that has this machine's row, or
   *  revoked), whose listings go. */
  function observeFleet(machines: readonly FleetMember[]): void {
    const own = machines.find((m) => m.isLocal);
    const members = new Set(
      machines.flatMap((m) => (m.isLocal || gone(m) ? [] : [m.peerId]))
    );
    const before = self;
    self = own?.peerId ?? self;
    let changed = self !== before;
    for (const machine of [...listings.keys()]) {
      if (machine === LOCAL_MACHINE || members.has(machine)) continue;
      if (!own && !machines.some((m) => m.peerId === machine)) continue;
      listings.delete(machine);
      changed = true;
    }
    if (changed) derive();
  }

  return {
    observe,
    observeFleet,
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
    /** A session's affiliation, else, before any listing names it, the
     *  place of the directory it runs in, by the rule listings use. */
    ofOrPlace(key: string, dir: string, machine = LOCAL_MACHINE): Affiliation {
      return (
        snapshot.sessions.get(key) ??
        placeAffiliation(launchPlaceOf(dir, machine), machine)
      );
    },
    /** The parent group of the agent working in a checkout, if any. */
    ofCheckout(path: string, machine = LOCAL_MACHINE): Affiliation | undefined {
      return snapshot.worktrees.get(checkoutKey(path, machine));
    },
  };
}
