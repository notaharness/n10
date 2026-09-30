import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { hasOrphanedFetch } from './orphaned-fetch.js';
import type { Tab } from './tabs-model.js';

/** How long the pointer rests on a tab or a sidebar row before its
 *  pane is rendered ahead of the switch. */
export const PREWARM_HOVER_MS = 150;

/**
 * The pane a hover asked the editor to hold ready.
 *
 * One at a time, and nothing queues. Leaving a hovered element lets
 * its pane go, which ends its session watch and drops its queries'
 * observers; their reads still come back into the cache, since a call
 * to the host cannot be taken back. Until they have, a new hover warms
 * nothing — it is dropped, not deferred — so reads for panes nobody
 * looks at never stack up. `seq` counts changes, so the editor can
 * tell a hover that came after a switch from one it already used.
 * `onStrip` says the tab is on the tab strip, rather than the one a
 * sidebar row would open.
 */
interface PrewarmState {
  tab: Tab | null;
  seq: number;
  onStrip: boolean;
}

interface PrewarmApi extends PrewarmState {
  /** The pointer settled on `tab`: hold its pane ready. */
  warm: (tab: Tab, onStrip: boolean) => void;
  /** The pointer left `id`: let its pane go, if a hover still holds it. */
  cool: (id: string) => void;
}

// Outside a provider (a component rendered on its own) nothing warms.
const PrewarmContext = createContext<PrewarmApi>({
  tab: null,
  seq: 0,
  onStrip: false,
  warm: () => undefined,
  cool: () => undefined,
});

export function PrewarmProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<PrewarmState>({
    tab: null,
    seq: 0,
    onStrip: false,
  });
  const warm = useCallback(
    (tab: Tab, onStrip: boolean) => {
      // The last pane let go of is still reading: drop this one. (The
      // pointer left that pane's element, which let it go, before it
      // came to rest here.)
      if (hasOrphanedFetch(client)) return;
      setState((s) =>
        s.tab?.id === tab.id ? s : { tab, seq: s.seq + 1, onStrip }
      );
    },
    [client]
  );
  const cool = useCallback(
    (id: string) =>
      setState((s) =>
        s.tab?.id === id ? { tab: null, seq: s.seq + 1, onStrip: false } : s
      ),
    []
  );
  const api = useMemo(() => ({ ...state, warm, cool }), [state, warm, cool]);
  return (
    <PrewarmContext.Provider value={api}>{children}</PrewarmContext.Provider>
  );
}

export function usePrewarm(): PrewarmApi {
  return useContext(PrewarmContext);
}

/**
 * Hover handlers that hold `target()`'s pane ready once the pointer
 * has rested on the element for `PREWARM_HOVER_MS`.
 *
 * Only a real mouse moving counts: a row scrolled under a still
 * pointer gets moves with no movement, and a wheel over it cancels, so
 * scrolling past a list warms nothing; neither does sweeping across
 * it, since every move restarts the wait. Leaving lets the pane go, and
 * so does the element going away (a closed tab, a row that left the
 * list). `onStrip` marks a tab on the tab strip. `pressed` is for the element's own press handler: a press wins over
 * a hover in progress, and the pane it warmed is now the one shown.
 */
export function useHoverPrewarm(target: () => Tab | null, onStrip = false) {
  const { warm, cool } = usePrewarm();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warmed = useRef<string | null>(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(
    () => () => {
      cancel();
      if (warmed.current !== null) cool(warmed.current);
    },
    [cancel, cool]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
      if (e.movementX === 0 && e.movementY === 0) return;
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        const tab = targetRef.current();
        if (!tab) return;
        warmed.current = tab.id;
        warm(tab, onStrip);
      }, PREWARM_HOVER_MS);
    },
    [cancel, warm, onStrip]
  );
  const onPointerLeave = useCallback(() => {
    cancel();
    if (warmed.current !== null) cool(warmed.current);
    warmed.current = null;
  }, [cancel, cool]);
  const pressed = useCallback(() => {
    cancel();
    warmed.current = null;
  }, [cancel]);

  return {
    handlers: { onPointerMove, onPointerLeave, onWheel: cancel },
    pressed,
  };
}
