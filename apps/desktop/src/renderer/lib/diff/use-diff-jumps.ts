import { elementScroll, type Virtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type Ref,
  type RefObject,
} from 'react';
import type { FileBody } from './diff-bodies.js';
import { pointKey } from './diff-points.js';
import type { FlatRow } from './diff-virtual.js';
import type { LinePoint } from './range-selection.js';

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
  /** Scroll a line into view; until its file's lines are read, or while
   *  a fold hides it, its file's header stands in. */
  jumpToLine(point: LinePoint): boolean;
  /** Scroll back to a place `topRow` gave. */
  jumpToRow(place: RowPlace): boolean;
  /** Scroll to the top of the list. */
  jumpToTop(): void;
  /** Where the viewport starts, if anything is on screen. */
  topRow(): RowPlace | null;
}

type Place = Pick<RowPlace, 'key' | 'offset'>;

type Target =
  | { id: string }
  | { file: string }
  | { line: LinePoint }
  | { row: Place }
  | { top: true };

/** No read in flight, and no file on screen waiting for one: a jump
 *  lands before its file's batch is even asked for. A worktree's
 *  files all arrive with their lines. */
export function readsSettled(
  prDiff:
    | { settled: boolean; bodies: ReadonlyMap<string, FileBody> }
    | undefined,
  onScreen: ReadonlySet<string>
): boolean {
  if (!prDiff) return true;
  for (const f of onScreen) {
    if (prDiff.bodies.get(f)?.state === 'loading') return false;
  }
  return prDiff.settled;
}

/** The virtualizer's own scrolling, told to `scrolledRef` as it happens. */
export function scrollTelling(
  scrolledRef: RefObject<(() => void) | null>
): typeof elementScroll {
  return (offset, options, instance) => {
    elementScroll(offset, options, instance);
    scrolledRef.current?.();
  };
}

/** Where the rows are, in the terms a jump names them. */
interface RowIndex {
  indexById: ReadonlyMap<string, number>;
  fileIndex: ReadonlyMap<string, number>;
  /** The row each shown line is on, by `pointKey`. */
  rowOf: ReadonlyMap<string, number>;
}

/** Where the reader is: the row at the top of the viewport and, for when
 *  that row goes, its file's header. */
interface Kept {
  row: Place;
  header: Place | null;
}

function indexOf(
  target: Target,
  index: RowIndex,
  rows: readonly FlatRow[]
): number | undefined {
  if ('id' in target) return index.indexById.get(target.id);
  if ('file' in target) return index.fileIndex.get(target.file);
  if ('line' in target)
    return (
      index.rowOf.get(pointKey(target.line)) ??
      index.fileIndex.get(target.line.file)
    );
  if ('row' in target) {
    const i = rows.findIndex((r) => r.key === target.row.key);
    return i < 0 ? undefined : i;
  }
  return 0;
}

/** The place at `offset`, in the rows the list last laid out; null while
 *  the virtualizer measures rows not laid out yet. */
function placeAt(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  laidOut: { rows: readonly FlatRow[]; index: RowIndex },
  offset: number
): Kept | null {
  const item = virtualizer.getVirtualItemForOffset(offset);
  const row = item && laidOut.rows[item.index];
  if (!item || !row || row.key !== item.key) return null;
  const h = 'file' in row ? laidOut.index.fileIndex.get(row.file) : undefined;
  const header = h === undefined ? undefined : virtualizer.measurementsCache[h];
  return {
    row: { key: row.key, offset: offset - item.start },
    header: header
      ? { key: String(header.key), offset: offset - header.start }
      : null,
  };
}

/**
 * Jumps into the list that land where they aimed, and a reader who stays
 * where they are.
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
 *
 * Reads land and are let go above the reader, too, and a file let go
 * gives way to a notice only about its size. Whatever the rows above
 * do, the row at the top of the viewport keeps its place — or, when it
 * went (a notice replaced by the lines it stood for), its file's header
 * does. A list at its very top stays there instead, as the browser's
 * own scroll anchoring does, so rows arriving above the first are seen.
 * The place is noted as the reader scrolls and as the list scrolls
 * itself (`scrolledRef`, called from the virtualizer's `scrollToFn`):
 * the browser reports a scroll only a frame later, and rows can change
 * in between.
 */
export function useDiffJumps(
  jumpRef: Ref<DiffJumpHandle> | undefined,
  flat: Omit<RowIndex, 'rowOf'>,
  rowOf: RowIndex['rowOf'],
  rows: readonly FlatRow[],
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  scrollRef: RefObject<HTMLDivElement | null>,
  scrolledRef: RefObject<(() => void) | null>,
  settled: boolean
) {
  const { indexById, fileIndex } = flat;
  const index = useMemo(
    () => ({ indexById, fileIndex, rowOf }),
    [indexById, fileIndex, rowOf]
  );
  const pending = useRef<Target | null>(null);
  const kept = useRef<Kept | null>(null);
  const laidOut = useRef({ rows, index });

  const scrollTo = useCallback(
    (target: Target) => {
      const i = indexOf(target, index, rows);
      if (i == null) return false;
      if ('row' in target) {
        // Sizes measured since the list rendered count too: asking for
        // its size brings them in.
        virtualizer.getTotalSize();
        const start = virtualizer.getOffsetForIndex(i, 'start');
        if (!start) return false;
        const offset = start[0] + target.row.offset;
        const now = scrollRef.current?.scrollTop;
        if (now === undefined || Math.abs(offset - now) >= 1) {
          virtualizer.scrollToOffset(offset);
        }
      } else if ('top' in target) {
        virtualizer.scrollToOffset(0);
      } else {
        virtualizer.scrollToIndex(i, {
          align: 'id' in target ? 'center' : 'start',
        });
      }
      return true;
    },
    [index, rows, virtualizer, scrollRef]
  );

  const note = useCallback(() => {
    const top = scrollRef.current?.scrollTop ?? 0;
    if (top <= 0) {
      kept.current = null;
      return;
    }
    kept.current = placeAt(virtualizer, laidOut.current, top) ?? kept.current;
  }, [virtualizer, scrollRef]);

  // New rows, before they are painted: the reader keeps their place,
  // unless a jump is still aiming (below).
  useLayoutEffect(() => {
    if (laidOut.current.rows === rows) return;
    laidOut.current = { rows, index };
    const was = kept.current;
    if (was && !pending.current && !scrollTo({ row: was.row }) && was.header) {
      scrollTo({ row: was.header });
    }
    note();
  }, [rows, index, scrollTo, note]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    scrolledRef.current = note;
    el?.addEventListener('scroll', note, { passive: true });
    return () => {
      scrolledRef.current = null;
      el?.removeEventListener('scroll', note);
    };
  }, [scrollRef, scrolledRef, note]);

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
        jumpToLine: (line) => jump({ line }),
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
