import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  usePanelCallbackRef,
  type LayoutChangedMeta,
  type PanelImperativeHandle,
} from 'react-resizable-panels';

const listeners = new Map<string, Set<() => void>>();

function readWidth(key: string): number | null {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** `null` forgets the width: the pane goes back to its built-in one. */
function storeWidth(key: string, px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(px)));
  } catch {
    // A convenience only: the pane opens at its default width next time.
  }
  listeners.get(key)?.forEach((notify) => notify());
}

function subscribe(key: string, notify: () => void): () => void {
  const set = listeners.get(key) ?? new Set();
  listeners.set(key, set);
  set.add(notify);
  return () => set.delete(notify);
}

export interface PaneWidth {
  /** For the Panel: the remembered width, or the built-in one. */
  defaultSize: string;
  panelRef: Dispatch<SetStateAction<PanelImperativeHandle | null>>;
  /** For the Group: remembers the width the user dragged to. */
  onLayoutChanged: (layout: unknown, meta: LayoutChangedMeta) => void;
  /** For the Separator, with the library's own reset disabled: a
   *  double-click forgets the width, back to the built-in one. */
  onReset: () => void;
}

/**
 * A side pane's width in pixels, kept across remounts (a repo switch
 * remounts the workspace) and restarts, and shared by every mounted
 * pane under the same key (a hidden spare tab has its own). Only a
 * user's drag or key press is saved: a window resize can clamp the pane
 * to its max size, and that should not become the width it reopens at.
 */
export function usePaneWidth(key: string, fallbackPx: number): PaneWidth {
  const width = useSyncExternalStore(
    useCallback((notify: () => void) => subscribe(key, notify), [key]),
    () => readWidth(key) ?? fallbackPx
  );
  // State, not a ref: the effect below must run when the pane mounts,
  // shown again too, where the Group would restore a cached percentage.
  // The Group has laid the pane out by then, and it is not yet painted.
  const [panel, panelRef] = usePanelCallbackRef();
  useLayoutEffect(() => {
    panel?.resize(`${width}px`);
  }, [panel, width]);

  // One read per frame, dropped when superseded, reset or unmounted:
  // a detached pane throws on getSize().
  const pending = useRef(0);
  const later = useCallback((read: () => void) => {
    cancelAnimationFrame(pending.current);
    pending.current = requestAnimationFrame(read);
  }, []);
  useEffect(() => () => cancelAnimationFrame(pending.current), []);

  const onLayoutChanged = useCallback(
    (_layout: unknown, meta: LayoutChangedMeta) => {
      if (!panel) return;
      // The new size reaches the DOM on React's next commit; a key press
      // reports before it, so read the pane once it has been painted.
      later(() => {
        const px = panel.getSize().inPixels;
        if (meta.isUserInteraction) {
          if (px > 0) storeWidth(key, px);
        } else if (px < width - 1) {
          // A window grown back after its max size clamped the pane:
          // preserve-pixel-size would keep the clamped width.
          panel.resize(`${width}px`);
        }
      });
    },
    [key, later, panel, width]
  );
  const onReset = useCallback(() => {
    cancelAnimationFrame(pending.current);
    storeWidth(key, null);
  }, [key]);
  return {
    defaultSize: `${width}px`,
    panelRef,
    onLayoutChanged,
    onReset,
  };
}
