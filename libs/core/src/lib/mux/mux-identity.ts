import { realpathSync } from 'node:fs';
import type { ManagedCatalog, ManagedRecord } from '../managed-catalog.js';
import { ORCHESTRA_TAG } from '../session-identity.js';
import { MuxError } from './mux-error.js';
import type { MetadataRequest } from './mux-requests.js';

/** The rules that keep identity tags honest in one owner. */

const CHECKOUT = ORCHESTRA_TAG.worktreePath;
const CLAIM = ORCHESTRA_TAG.target;

/** Tags with their checkout in its canonical spelling, so `/repo/wt`,
 *  `/repo/wt/` and a symlink to it are one checkout. A path that does
 *  not exist (any more) keeps its spelling. */
export function canonicalCheckout(
  tags: Record<string, string>
): Record<string, string> {
  const checkout = tags[CHECKOUT];
  if (checkout === undefined) return tags;
  try {
    return { ...tags, [CHECKOUT]: realpathSync.native(checkout) };
  } catch {
    return tags;
  }
}

/** A checkout belongs to one session: no other may claim it. */
export function checkCheckout(
  catalog: ManagedCatalog,
  tags: Record<string, string>,
  self?: ManagedRecord
): void {
  const checkout = tags[CHECKOUT];
  if (checkout === undefined) return;
  const holder = catalog
    .all()
    .find((other) => other !== self && other.tags[CHECKOUT] === checkout);
  if (holder)
    throw new MuxError(
      'IDENTITY_MISMATCH',
      `${checkout} belongs to session ${holder.sessionId}`
    );
}

/**
 * A session claims a target only for itself: the caller names the
 * session and generation it runs as (its own `N10_MUX_*`), and they
 * must be this record's current ones. The claim then leaves any other
 * record in the same step.
 */
export function moveClaim(
  catalog: ManagedCatalog,
  record: ManagedRecord,
  request: MetadataRequest
): void {
  const { claimTarget, caller } = request;
  if (claimTarget === undefined) return;
  const own =
    caller?.hostId === catalog.hostId &&
    caller.sessionId === record.sessionId &&
    caller.generation === record.pty.generation;
  if (!own)
    throw new MuxError(
      'IDENTITY_MISMATCH',
      'Only a session can claim a target, and only for itself'
    );
  for (const other of catalog.all())
    if (other !== record && other.tags[CLAIM] === claimTarget)
      catalog.retag(other, { [CLAIM]: null });
}
