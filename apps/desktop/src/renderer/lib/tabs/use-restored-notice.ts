import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { restoredGone, type TerminalEntry } from './tab-terminals.js';
import type { Tab } from './tabs-model.js';

/** What the notice says for `n` restored terminals given up. */
export function goneNotice(n: number): string {
  return n === 1
    ? '1 session is no longer available'
    : `${n} sessions are no longer available`;
}

/**
 * Say once, when the first listing arrives, how many restored terminal
 * tabs it is about to close because their sessions are gone. Call it
 * before the effect that dispatches the sync: effects run in order, so
 * this one still sees the tabs the sync will close.
 */
export function useRestoredNotice(
  tabs: readonly Tab[],
  entries: readonly TerminalEntry[] | undefined
): void {
  const told = useRef(false);
  useEffect(() => {
    if (told.current || !entries) return;
    if (!tabs.some((t) => t.kind === 'terminal' && t.restored)) return;
    const gone = restoredGone(tabs, entries);
    if (gone === 0) return;
    told.current = true;
    toast(goneNotice(gone), { duration: 4000 });
  }, [tabs, entries]);
}
