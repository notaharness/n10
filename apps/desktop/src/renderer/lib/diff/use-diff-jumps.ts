import type { Virtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type Ref,
  type RefObject,
} from 'react';
import type { FlatRow } from './diff-virtual.js';

/** A place in the list: a row, and how far into it the viewport starts.
 *  Rows keep their keys across layouts, so the place survives a switch
 *  between every file and one at a time. */
export interface RowPlace {
  key: string;
  offset: number;
  /** The file the row belongs to; null for the conversation. */
  file: string | null;
}

/** Imperative scrolling into the virtualized list — jump targets may
 *  not be materialized yet, so DOM queries can't do this. */
export interface DiffJumpHandle {
  /** Scroll the row containing this thread/draft id into view. */
  jumpToId(id: string): boolean;
  /** Scroll a file's header row into view. */
  jumpToFile(file: string): boolean;
  /** Scroll back to a place `topRow` gave. */
  jumpToRow(place: RowPlace): boolean;
  /** Scroll to the top of the list. */
  jumpToTop(): void;
  /** Where the viewport starts, if anything is on screen. */
  topRow(): RowPlace | null;
}

type Target =
  | { id: string }
  | { file: string }
  | { row: RowPlace }
  | { top: true };

/** Where the rows are, in the terms a jump names them. */
interface RowIndex {
  indexById: ReadonlyMap<string, number>;
  fileIndex: ReadonlyMap<string, number>;
}

function indexOf(
  target: Target,
  index: RowIndex,
  rows: readonly FlatRow[]
): number | undefined {
  if ('id' in target) return index.indexById.get(target.id);
  if ('file' in target) return index.fileIndex.get(target.file);
  if ('row' in target) {
    const i = rows.findIndex((r) => r.key === target.row.key);
    return i < 0 ? undefined : i;
  }
  return 0;
}

/**
 * Jumps into the list that land where they aimed.
 *
 * A jump scrolls to where its target is now, but a pull request's
 * files arrive a batch at a time: the batch holding the target — and
 * the files above it — can land after the jump and push the target off
 * screen. So a jump stays pending and is made again each time the rows
 * change. It ends when the reader scrolls for themselves, when its
 * target leaves the rows, or once the reads are done (`settled`: none
 * in flight, and no file on screen waiting for one — a jump lands
 * before its file's batch is asked for). After that nothing is left to
 * move it, and a later change — a poll, Hide resolved — must not pull
 * the reader back.
 */
export function useDiffJumps(
  jumpRef: Ref<DiffJumpHandle> | undefined,
  index: RowIndex,
  rows: readonly FlatRow[],
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  scrollRef: RefObject<HTMLDivElement | null>,
  settled: boolean
) {
  const pending = useRef<Target | null>(null);

  const scrollTo = useCallback(
    (target: Target) => {
      const i = indexOf(target, index, rows);
      if (i == null) return false;
      if ('row' in target) {
        const start = virtualizer.getOffsetForIndex(i, 'start');
        if (!start) return false;
        virtualizer.scrollToOffset(start[0] + target.row.offset);
      } else if ('top' in target) {
        virtualizer.scrollToOffset(0);
      } else {
        virtualizer.scrollToIndex(i, {
          align: 'id' in target ? 'center' : 'start',
        });
      }
      return true;
    },
    [index, rows, virtualizer]
  );

  // New rows: make the pending jump again, against where they put it.
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    if (!scrollTo(target) || settled) pending.current = null;
  }, [scrollTo, settled]);

  // The reader taking the scroll back ends the jump.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const drop = () => {
      pending.current = null;
    };
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    for (const e of events) el.addEventListener(e, drop, { passive: true });
    return () => {
      for (const e of events) el.removeEventListener(e, drop);
    };
  }, [scrollRef]);

  useImperativeHandle(
    jumpRef,
    () => {
      const jump = (target: Target) => {
        const ok = scrollTo(target);
        pending.current = ok ? target : null;
        return ok;
      };
      return {
        jumpToId: (id) => jump({ id }),
        jumpToFile: (file) => jump({ file }),
        jumpToRow: (row) => jump({ row }),
        jumpToTop: () => {
          jump({ top: true });
        },
        topRow: () => {
          const offset = virtualizer.scrollOffset ?? 0;
          for (const vi of virtualizer.getVirtualItems()) {
            const row = rows[vi.index];
            if (vi.end <= offset || !row) continue;
            return {
              key: row.key,
              offset: Math.max(0, offset - vi.start),
              file: 'file' in row ? row.file : null,
            };
          }
          return null;
        },
      };
    },
    [scrollTo, rows, virtualizer]
  );
}
