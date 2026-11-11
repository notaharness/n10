import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { LoadedWorkspace } from '../../../host/contract.js';
import { restoreWorkspace, toSaved } from './workspace-file.js';
import { EMPTY_WORKSPACE, type Workspace } from './workspace.js';

/** The workspace a launch starts from, and the one notice it may need. */
function startFrom(loaded: LoadedWorkspace): Workspace {
  if (loaded.status === 'set-aside') {
    console.warn(`[tabs] unreadable workspace moved to ${loaded.path}`);
    toast.error('Workspace could not be restored');
  }
  return loaded.status === 'restored'
    ? restoreWorkspace(loaded.workspace)
    : EMPTY_WORKSPACE;
}

/**
 * The saved workspace, read once from the host: `null` until it has
 * answered. The strip is not drawn before then, so the first
 * `sync-items` reconciles against the restored tabs and not an empty
 * strip. A host that cannot answer gives the empty workspace — the
 * strip must come up regardless.
 */
export function useRestoredWorkspace(): Workspace | null {
  const [restored, setRestored] = useState<Workspace | null>(null);
  useEffect(() => {
    let live = true;
    window.n10
      .loadWorkspace()
      .then(startFrom)
      .catch((error: unknown) => {
        console.warn('[tabs] could not restore the workspace', error);
        return EMPTY_WORKSPACE;
      })
      .then((ws) => {
        if (live) setRestored(ws);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return restored;
}

/**
 * Hand the host every workspace that saves differently from the last
 * one; it debounces the writes. The restored workspace is where this
 * starts, and is not written back. A failed write leaves the last good
 * file, and says so once until a later write lands.
 */
export function useSaveWorkspace(ws: Workspace): void {
  const last = useRef<string | null>(null);
  const failing = useRef(false);
  useEffect(() => {
    const saved = toSaved(ws);
    const json = JSON.stringify(saved);
    const first = last.current === null;
    if (json === last.current) return;
    last.current = json;
    if (first) return;
    window.n10.saveWorkspace(saved).then(
      () => {
        failing.current = false;
      },
      (error: unknown) => {
        console.warn('[tabs] could not save the workspace', error);
        if (failing.current) return;
        failing.current = true;
        toast.error('Workspace changes could not be saved');
      }
    );
  }, [ws]);
}
