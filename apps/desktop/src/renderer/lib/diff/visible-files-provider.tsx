import { useCallback, useState, type ReactNode } from 'react';
import { usePaneShown } from '../tabs/pane-shown.js';
import {
  NO_VISIBLE_FILES,
  VisibleFilesContext,
  ReportVisibleFilesContext,
} from './visible-files-context.js';

/** Visibility belongs to this workspace, and only while its diff is shown. */
export function VisibleDiffFiles({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const shown = usePaneShown();
  const [files, setFiles] = useState(NO_VISIBLE_FILES);
  const report = useCallback((next: ReadonlySet<string>) => {
    setFiles((prev) =>
      prev.size === next.size && [...prev].every((file) => next.has(file))
        ? prev
        : next
    );
  }, []);
  return (
    <ReportVisibleFilesContext.Provider value={report}>
      <VisibleFilesContext.Provider
        value={active && shown ? files : NO_VISIBLE_FILES}
      >
        {children}
      </VisibleFilesContext.Provider>
    </ReportVisibleFilesContext.Provider>
  );
}
