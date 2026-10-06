import {
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { DiffLine } from '@n10/diff';
import type {
  FileDisplayState,
  FlatRow,
} from '../../../lib/diff/diff-virtual.js';
import type { TextMatch } from '../../../lib/diff/text-matches.js';

function matchRow(row: FlatRow, match: TextMatch): boolean {
  if (!('file' in row) || row.file !== match.file) return false;
  if (row.kind === 'unified' || row.kind === 'split-context') {
    return row.index === match.index;
  }
  return (
    row.kind === 'split-pair' &&
    (row.row.left?.index === match.index ||
      row.row.right?.index === match.index)
  );
}

function openTarget(prev: Map<string, FileDisplayState>, target: TextMatch) {
  const current = prev.get(target.file) ?? {};
  if (current.open && current.expanded?.has(target.index)) return prev;
  const next = new Map(prev);
  next.set(target.file, {
    ...current,
    open: true,
    expanded: new Set(current.expanded).add(target.index),
  });
  return next;
}

/** Reveal a collapsed source line before the virtualizer can scroll to it. */
export function useDiffSearchTarget(
  target: TextMatch | null,
  request: number,
  rows: FlatRow[],
  linesByFile: ReadonlyMap<string, DiffLine[]>,
  setFileState: Dispatch<SetStateAction<Map<string, FileDisplayState>>>,
  scrollToIndex: (index: number) => void,
  scrollRef: RefObject<HTMLDivElement | null>
) {
  const scrolled = useRef(0);
  const revealed = useRef(0);
  useEffect(() => {
    if (
      !target ||
      !request ||
      scrolled.current === request ||
      !linesByFile.get(target.file)?.length
    )
      return;
    if (!rows.some((row) => matchRow(row, target))) {
      setFileState((prev) => openTarget(prev, target));
    }
  }, [target, request, rows, linesByFile, setFileState]);

  useEffect(() => {
    if (!target || !request || scrolled.current === request) return;
    const index = rows.findIndex((row) => matchRow(row, target));
    if (index >= 0) {
      scrollToIndex(index);
      scrolled.current = request;
    }
  }, [target, request, rows, scrollToIndex]);

  useEffect(() => {
    if (
      !target ||
      !request ||
      revealed.current === request ||
      scrolled.current !== request
    )
      return;
    let canceled = false;
    const reveal = (left: number) => {
      if (canceled) return;
      const mark = scrollRef.current?.querySelector<HTMLElement>(
        '[data-diff-search-active="true"]'
      );
      if (mark) {
        mark.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        revealed.current = request;
      } else if (left > 0) requestAnimationFrame(() => reveal(left - 1));
    };
    requestAnimationFrame(() => reveal(10));
    return () => {
      canceled = true;
    };
  }, [target, request, rows, scrollRef]);
}
