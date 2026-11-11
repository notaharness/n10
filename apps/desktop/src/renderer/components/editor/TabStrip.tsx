import {
  DndContext,
  PointerSensor,
  useDndContext,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type DragEndEvent,
  type Over,
} from '@dnd-kit/core';
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
} from '@dnd-kit/modifiers';
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { collisionsEndingAt, END_ID, groupEndId } from './strip-collisions.js';
import { StripScrollArrows } from './StripScrollArrows.js';
import { useStripScrollEdges } from './use-strip-scroll-edges.js';
import {
  acceptsDrop,
  dropMove,
  isStripDragData,
  type StripBlocks,
  type StripDragData,
} from './strip-drag.js';
import { useTabs } from '../../lib/tabs/tabs.js';
import { setStripDragging } from '../../lib/tabs/tab-switching.js';
import { usePrefersReducedMotion } from '../../lib/reduced-motion.js';
import { cn } from '../../lib/utils.js';
import {
  ChordKeyboardSensor,
  handleTabKey,
  screenReaderInstructions,
  type TabKeyActions,
} from './tab-keyboard.js';

/** How far the pointer travels before a press becomes a drag, so
 *  clicks and double clicks on a tab stay clicks. */
const DRAG_THRESHOLD_PX = 5;

/** A tab as a screen reader hears it: its label, not its id. */
function spoken(target: Active | Over): string {
  const data = target.data.current;
  return isStripDragData(data) ? data.label : String(target.id);
}

/** Where a place stands among those the drag may land on: its
 *  sortable list's, a group's members or the strip's blocks. */
function position(over: Over): string | undefined {
  const sortable = (
    over.data.current as
      | { sortable?: { index: number; items: unknown[] } }
      | undefined
  )?.sortable;
  return sortable
    ? `Position ${sortable.index + 1} of ${sortable.items.length}.`
    : undefined;
}

const announcements: Announcements = {
  onDragStart: ({ active }) => `Moving ${spoken(active)}.`,
  onDragOver: ({ over }) => (over ? position(over) : undefined),
  onDragEnd: ({ active, over }) =>
    over ? `Moved ${spoken(active)}.` : 'Move cancelled.',
  onDragCancel: () => 'Move cancelled.',
};

/** Where the strip tells the drag what its blocks are, as presented. */
const StripBlocksReport = createContext<(blocks: StripBlocks) => void>(
  () => undefined
);

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
  const wrap = useDesktopPrefs().tabOverflow === 'wrap';
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_THRESHOLD_PX },
    }),
    useSensor(ChordKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  // The strip's blocks as last rendered: a block's drop arranges them.
  const blocks = useRef<StripBlocks>([]);
  const reportBlocks = useCallback((next: StripBlocks) => {
    blocks.current = next;
  }, []);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const dragged = active.data.current;
    const target = over?.data.current;
    if (!over || !isStripDragData(dragged) || !isStripDragData(target)) return;
    const drop = dropMove(
      String(active.id),
      dragged,
      String(over.id),
      target,
      blocks.current
    );
    if (drop?.kind === 'move')
      tabs.moveTabs(drop.ids, drop.targetId, drop.side);
    else if (drop) tabs.arrangeTabs(drop.ids);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionsEndingAt}
      // The dragged tab stays inside the strip. Carried past its end, it
      // would widen the nearest scrolling box (the strip, scrolled; the
      // editor column, wrapped), which auto-scroll then scrolls after
      // the pointer, carrying the tab further: the box grows for as long
      // as the pointer stays there.
      modifiers={
        wrap
          ? [restrictToParentElement]
          : [restrictToHorizontalAxis, restrictToParentElement]
      }
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={() => setStripDragging(true)}
      onDragCancel={() => setStripDragging(false)}
      onDragEnd={(event) => {
        setStripDragging(false);
        onDragEnd(event);
      }}
    >
      <StripBlocksReport.Provider value={reportBlocks}>
        {children}
      </StripBlocksReport.Provider>
    </DndContext>
  );
}

/**
 * The tab row, sortable in `TabDragProvider`: its blocks (a group, or a
 * tab standing alone) in one sortable list, each group's members in a
 * list of their own.
 *
 * More tabs than fit wrap onto more rows, or, as the desktop prefs say
 * (`tabOverflow`, chosen from a tab's menu), scroll the one row
 * sideways. Wrapped, a group is a block that breaks only between its
 * members, and dnd-kit sorts by rectangles; in one row, a horizontal list.
 */
export function TabStrip({
  blocks,
  children,
  controls,
}: {
  /** Each block's sortable id and its tabs, in strip order. */
  blocks: readonly { id: string; ids: readonly string[] }[];
  children: ReactNode;
  controls: ReactNode;
}) {
  const wrap = useDesktopPrefs().tabOverflow === 'wrap';
  const report = useContext(StripBlocksReport);
  useLayoutEffect(() => report(blocks.map((b) => b.ids)), [report, blocks]);
  const blockKey = blocks.map((block) => block.id).join('\n');
  const { track, edges, update } = useStripScrollEdges(blockKey, wrap);
  return (
    <SortableContext
      items={blocks.map((b) => b.id)}
      strategy={wrap ? rectSortingStrategy : horizontalListSortingStrategy}
    >
      <div className="flex min-w-0 shrink-0 border-b border-border bg-tab">
        <div
          ref={track}
          role="tablist"
          aria-label="Open tabs"
          data-overflow={wrap ? 'wrap' : 'scroll'}
          className={cn(
            'flex min-w-0 flex-1 items-stretch gap-2 bg-tab',
            wrap
              ? // Every row but the last is ruled off from the one below.
                'flex-wrap [&>*]:-mb-px [&>*]:border-b [&>*]:border-border'
              : 'h-9 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          )}
          onScroll={update}
        >
          {children}
          <StripEnd />
        </div>
        {!wrap && edges.overflow && (
          <StripScrollArrows
            left={edges.left}
            right={edges.right}
            track={track}
          />
        )}
        {controls}
      </div>
    </SortableContext>
  );
}

/** A group's members, sortable among themselves only. */
export function GroupMembers({
  ids,
  children,
}: {
  ids: readonly string[];
  children: ReactNode;
}) {
  const wrap = useDesktopPrefs().tabOverflow === 'wrap';
  return (
    <SortableContext
      items={[...ids]}
      strategy={wrap ? rectSortingStrategy : horizontalListSortingStrategy}
    >
      {children}
    </SortableContext>
  );
}

/**
 * The room after the last tab. Its growth outweighs the tabs', so it
 * takes the last row's room while each full row above is shared out
 * among its tabs. A drop target only for its rect, and only under the
 * pointer: collisions resolve it to the last place the drag may land
 * (`strip-collisions.ts`), and a keyboard drag, which steps from
 * droppable to droppable, skips it.
 */
function StripEnd() {
  const { active, activatorEvent } = useDndContext();
  const { setNodeRef } = useDroppable({
    id: END_ID,
    disabled:
      activatorEvent instanceof KeyboardEvent ||
      !isStripDragData(active?.data.current),
  });
  return <div ref={setNodeRef} aria-hidden className="grow-[9999] basis-0" />;
}

/**
 * The room after a wrapped group's last tab: the place its last member
 * goes for a drag of one of its members (the strip's end, for a block's).
 */
export function GroupEnd({ group }: { group: string }) {
  const { active, activatorEvent } = useDndContext();
  const dragged = active?.data.current;
  const { setNodeRef } = useDroppable({
    id: groupEndId(group),
    disabled:
      activatorEvent instanceof KeyboardEvent ||
      !isStripDragData(dragged) ||
      dragged.kind !== 'member' ||
      dragged.group !== group,
  });
  return <div ref={setNodeRef} aria-hidden className="grow-[9999] basis-0" />;
}

/** A press that selects a tab as it goes down: the primary button
 *  alone, not on the tab's close button. Modified presses and the
 *  other buttons keep their click, middle-click and menu meanings. */
function selectsOnPress(e: PointerEvent<HTMLElement>): boolean {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
    return false;
  return !(e.target as Element).closest('button');
}

const roleDescriptionOf = (data: StripDragData) =>
  data.kind === 'block' && data.ids.length > 1
    ? 'sortable tab group'
    : 'sortable tab';

/**
 * What a sortable place on the strip spreads onto its elements: a tab,
 * or a group's block with its chip body as the handle. `data` says what
 * it is (`strip-drag.ts`); a place the drag under way may not land on is
 * no drop target. `tabStop` makes it the row's one Tab stop (the arrows
 * move focus within the row).
 *
 * `selectOnPress`: a primary press selects the tab as the button goes
 * down, the way browsers' and editors' tabs do, rather than on release.
 * It runs after the pointer sensor's own `onPointerDown`, which only
 * starts watching the pointer: the tab lifts once it has travelled
 * `DRAG_THRESHOLD_PX`, so a press that becomes a drag has selected the
 * tab it drags. A group's home tab, whose drag moves the whole group,
 * selects on click instead.
 */
export function useSortableTab({
  id,
  data,
  tabStop,
  actions,
  selectOnPress = true,
  role = 'tab',
  fixed = false,
}: {
  id: string;
  data: StripDragData;
  tabStop: boolean;
  actions: TabKeyActions;
  selectOnPress?: boolean;
  /** Neither dragged nor dropped on: a group shown behind the one it
   *  follows, which carries it. */
  fixed?: boolean;
  /** `button` for a chip body that is no tab (a stand-in, a place):
   *  Enter and Space press it, and the tab keys are not its. */
  role?: 'tab' | 'button';
}) {
  const reducedMotion = usePrefersReducedMotion();
  const dragging = useDndContext().active?.data.current;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    active,
  } = useSortable({
    id,
    data,
    disabled: {
      draggable: fixed,
      droppable:
        fixed ||
        !acceptsDrop(data, isStripDragData(dragging) ? dragging : undefined),
    },
    attributes: {
      role,
      roleDescription: roleDescriptionOf(data),
      // A button is always reachable with Tab; tabs share one stop.
      tabIndex: role === 'button' || tabStop ? 0 : -1,
    },
    // `null` turns the slide off; the tabs then jump to their places.
    transition: reducedMotion ? null : undefined,
  });
  const handle = {
    ...attributes,
    // dnd-kit says a draggable it may not lift is disabled; a fixed chip
    // still takes presses, Enter and its menu.
    ...(fixed ? { 'aria-disabled': undefined } : {}),
    ...listeners,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      listeners?.onPointerDown?.(e);
      if (selectOnPress && selectsOnPress(e)) actions.activate();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      listeners?.onKeyDown?.(e);
      // The sensor took it (the lift chord), a drag is under way, or
      // the key was meant for the close button inside the tab.
      if (e.defaultPrevented || active || e.target !== e.currentTarget) return;
      if (role === 'tab') handleTabKey(e, actions);
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        actions.activate();
      }
    },
  };
  return {
    /** The moving element. */
    setNode: setNodeRef,
    /** The element pressed to move it, which carries `handle`. */
    setHandle: setActivatorNodeRef,
    handle,
    style: { transform: CSS.Translate.toString(transform), transition },
    isDragging,
  };
}
