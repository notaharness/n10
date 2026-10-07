import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { usePaneShown } from '../tabs/pane-shown.js';
import type { FlatRow } from './diff-rows-model.js';
import { visibleFiles } from './visible-files.js';

const EMPTY: ReadonlySet<string> = new Set();
const VisibleFilesContext = createContext(EMPTY);
const ReportVisibleFilesContext = createContext<
  (files: ReadonlySet<string>) => void
>(() => undefined);

/** Visibility belongs to this workspace, and only while its diff is shown. */
export function VisibleDiffFiles({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const shown = usePaneShown();
  const [files, setFiles] = useState(EMPTY);
  const report = useCallback((next: ReadonlySet<string>) => {
    setFiles((prev) =>
      prev.size === next.size && [...prev].every((file) => next.has(file))
        ? prev
        : next
    );
  }, []);
  return (
    <ReportVisibleFilesContext.Provider value={report}>
      <VisibleFilesContext.Provider value={active && shown ? files : EMPTY}>
        {children}
      </VisibleFilesContext.Provider>
    </ReportVisibleFilesContext.Provider>
  );
}

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
  useEffect(() => () => report(EMPTY), [report]);
}
