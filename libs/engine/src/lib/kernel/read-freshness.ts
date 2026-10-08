/**
 * Whether a resource's repository is parked, and for how long a parked
 * repository's answers will do. A selected repository's reads keep each
 * resource's own TTL and wait for a read past it. A parked one's serve
 * whatever they hold at once, and start a read behind it only when what
 * they hold is older than `parkedTtl` or nothing is held at all.
 */
export interface ReadFreshness {
  parked(): boolean;
  parkedTtl: number;
}

/** A resource whose repository is always the one in use. */
export const ALWAYS_SELECTED: ReadFreshness = {
  parked: () => false,
  parkedTtl: 0,
};

/** Whether an answer from `at` still serves a parked repository with no
 *  read behind it. A resource whose own TTL is longer keeps it. */
export function parkedWarm(
  freshness: ReadFreshness,
  at: number | null,
  ttl: number,
  now = Date.now()
): boolean {
  return at !== null && now - at < Math.max(ttl, freshness.parkedTtl);
}
