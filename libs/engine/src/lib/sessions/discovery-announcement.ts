import type { DiscoveryDelta } from '@n10/core';

/** A listing is not itself a change; adoption or a changed session is. */
export function worthAnnouncing(
  delta: DiscoveryDelta,
  touched: number
): boolean {
  return (
    touched > 0 ||
    delta.appeared.length > 0 ||
    delta.disappeared.length > 0 ||
    delta.stranded.length > 0 ||
    delta.switched.length > 0 ||
    delta.ended.length > 0 ||
    delta.endedTerminals.length > 0
  );
}
