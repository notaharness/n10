import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CeremonyOutcome, DirectoryPublished } from '@n10/engine/contract';

type Succeeded = Extract<CeremonyOutcome, { ok: true }>;

/** A `directory.published` event's write. */
export function landedKey({ kind, peerId }: DirectoryPublished): string {
  return `${kind}/${peerId}`;
}

/** The write a ceremony queued, as its `directory.published` names it:
 *  this machine's membership, or the revoked machine's removal. */
export function publicationKey(outcome: Succeeded): string {
  return landedKey({
    kind: outcome.op === 'revoke' ? 'revoke' : 'member',
    peerId: outcome.peerId,
  });
}

/** The writes observed pending after a ceremony: a success that left
 *  its write pending adds it; anything else wrote nothing new. */
export function pendingAfter(
  pending: ReadonlyMap<string, Succeeded>,
  outcome: CeremonyOutcome
): ReadonlyMap<string, Succeeded> {
  if (!outcome.ok || outcome.published) return pending;
  return new Map(pending).set(publicationKey(outcome), outcome);
}

/**
 * Directory writes beam reported landed, and those ceremonies left
 * pending (beam-fleet-ux.md §1). Status cannot say a write is pending,
 * so only an observed pending result is shown, until its own event or
 * a reset.
 */
export function usePublication() {
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlyMap<string, Succeeded>>(
    new Map()
  );

  useEffect(
    () =>
      window.n10.onDirectoryPublished((event) =>
        setLanded((s) => new Set(s).add(landedKey(event)))
      ),
    []
  );

  const settle = useCallback(
    (outcome: CeremonyOutcome) => setPending((p) => pendingAfter(p, outcome)),
    []
  );
  const clear = useCallback(() => {
    setPending(new Map());
    setLanded(new Set());
  }, []);
  const isPublished = useCallback(
    (outcome: Succeeded) =>
      outcome.published || landed.has(publicationKey(outcome)),
    [landed]
  );

  return useMemo(
    () => ({
      /** A write is still waiting for its event. */
      pending: [...pending.keys()].some((key) => !landed.has(key)),
      pendingOperations: [
        ...new Set(
          [...pending]
            .filter(([key]) => !landed.has(key))
            .map(([, outcome]) => outcome.op)
        ),
      ],
      isPublished,
      settle,
      clear,
    }),
    [pending, landed, isPublished, settle, clear]
  );
}

export type Publication = ReturnType<typeof usePublication>;
