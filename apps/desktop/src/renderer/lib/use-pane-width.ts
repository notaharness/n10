import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import {
  usePanelCallbackRef,
  type Layout,
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
  /** For the Panel: its id, which also names the stored width. */
  id: string;
  /** For the Panel: the remembered width, or the built-in one. */
  defaultSize: string;
  panelRef: (handle: PanelImperativeHandle | null) => void;
  elementRef: (element: HTMLDivElement | null) => void;
  /** For the Group: remembers the width the user dragged to. */
  onLayoutChanged: (layout: Layout, meta: LayoutChangedMeta) => void;
  /** For the Separator, with the library's own reset disabled: a
   *  double-click forgets the width, back to the built-in one. */
  onReset: () => void;
}

/**
 * A side pane's width in pixels, kept across remounts (a repo switch
 * remounts the workspace) and restarts, and shared by every mounted
 * pane with the same id (a hidden spare tab has its own). Only a user's
 * drag or key press is saved: a window resize can clamp the pane to its
 * max size, and that should not become the width it reopens at.
 */
export function usePaneWidth(id: string, fallbackPx: number): PaneWidth {
  const key = `n10.${id}.width`;
  const width = useSyncExternalStore(
    useCallback((notify: () => void) => subscribe(key, notify), [key]),
    () => readWidth(key) ?? fallbackPx
  );
  // State, not a ref: the effect below must run when the pane mounts,
  // shown again too, where the Group would restore a cached percentage.
  // The Group has laid the pane out by then, and it is not yet painted.
  const [panel, setPanel] = usePanelCallbackRef();
  // The handle as of now: the state above lags a pane that just left,
  // whose getSize() throws, by a render.
  const live = useRef<PanelImperativeHandle | null>(null);
  const panelRef = useCallback(
    (handle: PanelImperativeHandle | null) => {
      live.current = handle;
      setPanel(handle);
    },
    [setPanel]
  );
  // The pane's element, for the group's width: the handle's own size
  // mixes the new layout's percentage with the old layout's pixels
  // until React paints the change, which a key press has not yet.
  const element = useRef<HTMLDivElement | null>(null);
  const elementRef = useCallback((el: HTMLDivElement | null) => {
    element.current = el;
  }, []);
  // The width as of now, for a read in a later frame.
  const current = useRef(width);
  useLayoutEffect(() => {
    current.current = width;
    // A pane that just left is still in the state, its handle detached.
    if (!panel || panel !== live.current) return;
    panel.resize(`${width}px`);
  }, [panel, width]);

  // One fit per frame, dropped when superseded, reset or unmounted.
  const fitting = useRef(0);
  useEffect(() => () => cancelAnimationFrame(fitting.current), []);

  const onLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!live.current) return;
      if (meta.isUserInteraction) {
        // The pane's new size is in the layout, not yet in the DOM; a
        // window resize a frame later could already have clamped it.
        const px = ((layout[id] ?? 0) * groupPixels(element.current)) / 100;
        if (px > 0) storeWidth(key, px);
        return;
      }
      // A window grown back after its max size clamped the pane:
      // preserve-pixel-size would keep the clamped width. Read once the
      // new layout is painted.
      cancelAnimationFrame(fitting.current);
      fitting.current = requestAnimationFrame(() => {
        const now = live.current;
        if (now && now.getSize().inPixels < current.current - 1) {
          now.resize(`${current.current}px`);
        }
      });
    },
    [id, key]
  );
  const onReset = useCallback(() => {
    cancelAnimationFrame(fitting.current);
    storeWidth(key, null);
  }, [key]);
  return {
    id,
    defaultSize: `${width}px`,
    panelRef,
    elementRef,
    onLayoutChanged,
    onReset,
  };
}

/** The panels' total width, separators left out, which a layout's
 *  percentages are of. A layout change moves width between panels, so
 *  the total is the same before React paints it as after. */
function groupPixels(pane: HTMLDivElement | null): number {
  const siblings = pane?.parentElement?.children ?? [];
  let total = 0;
  for (const el of siblings) {
    if (el instanceof HTMLElement && el.hasAttribute('data-panel')) {
      total += el.offsetWidth;
    }
  }
  return total;
}
