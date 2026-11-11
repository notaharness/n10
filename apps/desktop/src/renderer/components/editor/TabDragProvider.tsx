import {
  DndContext,
  PointerSensor,
  useDndContext,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { setStripDragging } from '../../lib/tabs/tab-switching.js';
import { useTabs } from '../../lib/tabs/tabs.js';
import { holdInStrip, type StripBox } from './drag-preview.js';
import { stripAnnouncements } from './strip-announcements.js';
import { StripBlocksReport } from './strip-blocks.js';
import { collisionsEndingAt } from './strip-collisions.js';
import { dropMove, isStripDragData, type StripBlocks } from './strip-drag.js';
import {
  ChordKeyboardSensor,
  screenReaderInstructions,
} from './tab-keyboard.js';
import { pointerSide, usePaneDrop } from './use-pane-drop.js';

/** How far the pointer travels before a press becomes a drag, so
 *  clicks and double clicks on a tab stay clicks. */
const DRAG_THRESHOLD_PX = 5;

/**
 * The drag and drop the tab strip sorts in, by pointer and by keyboard
 * (see `tab-keyboard.ts`: a chord lifts, so Enter and Space still
 * activate). The other tabs slide aside while one is dragged; the order
 * only changes in the model on drop.
 *
 * Above the repository gate, beside the tabs it sorts: a tab is chosen
 * on press, choosing another repository's tab opens that repository,
 * and the workspace, strip included, remounts under the new one. Out
 * here, the sensor watching the press outlives that remount, and lifts
 * the remounted tab by its id once the pointer has travelled
 * `DRAG_THRESHOLD_PX`.
 */
export function TabDragProvider({ children }: { children: ReactNode }) {
  const tabs = useTabs();
  const paneDrop = usePaneDrop();
  const wrap = useDesktopPrefs().tabOverflow === 'wrap';
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_THRESHOLD_PX },
    }),
    useSensor(ChordKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  // Each pane strip's blocks as last rendered: a block's drop arranges
  // its own pane's.
  const blocks = useRef(new Map<string, StripBlocks>());
  const reportBlocks = useCallback((pane: string, next: StripBlocks) => {
    blocks.current.set(pane, next);
  }, []);
  const onDragEnd = (event: DragEndEvent) => {
    if (paneDrop.drop(event)) return;
    const { active, over } = event;
    const dragged = active.data.current;
    const target = over?.data.current;
    if (!over || !isStripDragData(dragged) || !isStripDragData(target)) return;
    const drop = dropMove(
      String(active.id),
      dragged,
      String(over.id),
      target,
      blocks.current.get(dragged.pane ?? '') ?? [],
      pointerSide(over.rect)
    );
    if (drop?.kind === 'move')
      tabs.moveTabs(drop.ids, drop.targetId, drop.side);
    else if (drop) tabs.arrangeTabs(drop.ids);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionsEndingAt}
      autoScroll={{ threshold: { x: 0.08, y: 0.2 }, acceleration: 6 }}
      // The dragged tab stays inside the strip. Carried past its end, it
      // would widen the nearest scrolling box (the strip, scrolled; the
      // editor column, wrapped), which auto-scroll then scrolls after
      // the pointer, carrying the tab further: the box grows for as long
      // as the pointer stays there. A block carried out of the strip
      // leaves the tab in its place and shows a copy (`CarriedOverlay`).
      modifiers={[holdInStrip(wrap)]}
      accessibility={{
        announcements: stripAnnouncements,
        screenReaderInstructions,
      }}
      onDragStart={() => setStripDragging(true)}
      onDragCancel={() => {
        setStripDragging(false);
        paneDrop.clear();
      }}
      onDragEnd={(event) => {
        setStripDragging(false);
        onDragEnd(event);
        paneDrop.clear();
      }}
    >
      <PaneDropFollower follow={paneDrop.follow} />
      <StripBlocksReport.Provider value={reportBlocks}>
        {children}
      </StripBlocksReport.Provider>
    </DndContext>
  );
}

/** Hands the drag context's every change to the pane drop: what is
 *  dragged, what it is over, and the strip it started in. */
function PaneDropFollower({
  follow,
}: {
  follow: ReturnType<typeof usePaneDrop>['follow'];
}) {
  const { active, over, activeNode, activatorEvent } = useDndContext();
  useEffect(() => {
    // A keyboard drag stays on its strip: no box to be carried out of.
    const strip =
      activatorEvent instanceof KeyboardEvent
        ? null
        : activeNode?.closest('[role="tablist"], [data-roster-list]');
    follow(active ? { active, over } : null, strip ? stripBox(strip) : null);
  });
  return null;
}

/** The strip's box, and its row: as tall as the strip, as wide as its
 *  pane. */
function stripBox(strip: Element): StripBox {
  const { top, bottom, left, right, width, height } =
    strip.getBoundingClientRect();
  const pane = strip.closest('[data-pane-id]')?.getBoundingClientRect();
  return {
    strip: { top, bottom, left, right, width, height },
    row: {
      top,
      bottom,
      height,
      left: pane?.left ?? left,
      right: pane?.right ?? right,
      width: pane?.width ?? width,
    },
  };
}
