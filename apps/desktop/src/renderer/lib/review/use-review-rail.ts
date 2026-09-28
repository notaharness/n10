import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useNarrow } from '../use-narrow.js';
import {
  NARROW_WORKSPACE,
  RAIL_SHOWN,
  railAtWidth,
  railByReader,
} from './rail-model.js';
import { firstUnresolvedThread, type CommentRow } from './review-model.js';

/**
 * The review rail's own visibility: hidden or shown (by the reader, or
 * for a workspace too narrow for it; `rail-model.ts`), and the header's
 * "N unresolved" count, which takes the reader to the first open thread
 * in the diff.
 */
export function useReviewRail(
  nav: {
    items: readonly CommentRow[];
    jumpToId: (id: string, file: string | null) => void;
  },
  threads: { isFetching: boolean; refetch: () => Promise<unknown> },
  rootRef: RefObject<HTMLElement | null>
) {
  const narrow = useNarrow(rootRef, NARROW_WORKSPACE);
  const [rail, setRail] = useState(RAIL_SHOWN);
  // Adjusted during render, so the rail never paints at a width it has
  // already left.
  const atWidth = railAtWidth(rail, narrow);
  if (atWidth !== rail) setRail(atWidth);
  const { hidden } = atWidth;
  const setHidden = useCallback(
    (next: boolean) => setRail((r) => railByReader(r, next)),
    []
  );
  const { items, jumpToId } = nav;
  const { isFetching, refetch } = threads;
  const reveal = useCallback(
    (row: CommentRow) => jumpToId(row.id, row.file),
    [jumpToId]
  );

  // The count is the pull request list's and the threads are their own
  // query, so a click can land before the threads load or while the
  // cache is behind the count. Then the click is held, the threads are
  // fetched, and it lands once they arrive; if the fresh list has no
  // open thread either, it is dropped rather than firing later.
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) return;
    const first = firstUnresolvedThread(items);
    if (first) {
      pending.current = false;
      reveal(first);
    } else if (!isFetching) {
      pending.current = false;
    }
  }, [items, isFetching, reveal]);

  const showUnresolved = useCallback(() => {
    const first = firstUnresolvedThread(items);
    pending.current = first == null;
    if (first) {
      reveal(first);
      return;
    }
    refetch().catch(() => {
      pending.current = false;
    });
  }, [items, reveal, refetch]);

  return { hidden, setHidden, showUnresolved };
}
