import type { Virtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { pointKey, type LinePoints } from '../../../lib/diff/diff-points.js';
import type { LinePoint } from '../../../lib/diff/range-selection.js';
import { useTabView } from '../../../lib/tabs/tab-views.js';

/** How far below the top row to look for a line to anchor on (past a
 *  file header, a fold, a thread). */
const ANCHOR_REACH = 64;

/**
 * Keeps the tab's place in the diff: the line at the top of the list,
 * saved as the reader scrolls, and scrolled back to when the diff
 * mounts again. A line that is no longer in the diff, or no longer
 * shown, is not guessed at: the list starts from the top.
 */
export function useDiffAnchor({
  ready,
  points,
  virtualizer,
  scrollRef,
}: {
  /** The diff's files have arrived; before, nothing can be found. */
  ready: boolean;
  points: LinePoints;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollRef: RefObject<HTMLDivElement | null>;
}): void {
  const { saved, save } = useTabView();
  const restore = useRef(saved.anchor ?? null);

  const pointAt = useMemo(() => {
    const byRow = new Map<number, LinePoint>();
    for (const list of points.byFile.values()) {
      for (const p of list) {
        const row = points.rowOf.get(pointKey(p));
        if (row !== undefined && !byRow.has(row)) byRow.set(row, p);
      }
    }
    return byRow;
  }, [points]);

  useEffect(() => {
    const anchor = restore.current;
    if (!anchor || !ready) return;
    restore.current = null;
    const row = points.rowOf.get(pointKey(anchor));
    if (row === undefined) scrollRef.current?.scrollTo({ top: 0 });
    else virtualizer.scrollToIndex(row, { align: 'start' });
  }, [ready, points, virtualizer, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const top = virtualizer
          .getVirtualItems()
          .find((item) => item.end > el.scrollTop);
        let anchor: LinePoint | undefined;
        for (let i = 0; top && i < ANCHOR_REACH && !anchor; i++) {
          anchor = pointAt.get(top.index + i);
        }
        save({ anchor: el.scrollTop > 0 ? anchor : undefined });
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [pointAt, virtualizer, scrollRef, save]);
}
