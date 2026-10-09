import { createContext, useContext, useEffect } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { FlatRow } from './diff-rows-model.js';
import { visibleFiles } from './visible-files.js';

export const NO_VISIBLE_FILES: ReadonlySet<string> = new Set();
export const VisibleFilesContext = createContext(NO_VISIBLE_FILES);
export const ReportVisibleFilesContext = createContext<
  (files: ReadonlySet<string>) => void
>(() => undefined);

export function useVisibleDiffFiles(): ReadonlySet<string> {
  return useContext(VisibleFilesContext);
}

/** Reuse measured virtual rows rather than observing their overscan DOM. */
export function useReportVisibleDiffFiles(
  rows: readonly FlatRow[],
  virtualizer: Virtualizer<HTMLDivElement, Element>
) {
  const report = useContext(ReportVisibleFilesContext);
  const items = virtualizer.getVirtualItems();
  const offset = virtualizer.scrollOffset ?? 0;
  const height = virtualizer.scrollRect?.height ?? 0;
  useEffect(() => {
    report(visibleFiles(rows, items, offset, height));
  }, [report, rows, items, offset, height]);
  useEffect(() => () => report(NO_VISIBLE_FILES), [report]);
}
