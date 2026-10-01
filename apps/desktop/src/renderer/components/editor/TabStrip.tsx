import {
  closestCenter,
  DndContext,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type Over,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
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

/** The room after the last tab: over it, a drag is over the last tab. */
const END_ID = 'tab-strip-end';

/**
 * What the pointer is over, or, where it is over no tab (a keyboard
 * drag, or a border), the tab nearest the dragged one. Nearest alone
 * would take a tab on the row above for the room at the end of the row
 * below. That room counts as the last tab, so the sorting strategy
 * opens the end slot there as it does over the tab, and the drop lands
 * after it.
 */
function collisionsEndingAt(last: string | undefined): CollisionDetection {
  return (args) => {
    const within = pointerWithin(args);
    if (within[0]?.id === END_ID)
      return last === undefined ? [] : [{ id: last }];
    if (within.length > 0) return within;
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => c.id !== END_ID
      ),
    });
  };
}

/** A tab as a screen reader hears it: its label, not its id. */
function spoken(target: Active | Over): string {
  const data = target.data.current as { label?: string } | undefined;
  return data?.label ?? String(target.id);
}

const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${spoken(active)}.`,
  onDragOver: ({ active, over }) =>
    over
      ? `${spoken(active)} is over ${spoken(over)}.`
      : `${spoken(active)} is not over a tab.`,
  onDragEnd: ({ active, over }) =>
    over
      ? `${spoken(active)} was dropped over ${spoken(over)}.`
      : `${spoken(active)} was dropped.`,
  onDragCancel: ({ active }) => `Moving ${spoken(active)} was cancelled.`,
};

/**
 * The tab row, sortable by pointer and by keyboard (see
 * `tab-keyboard.ts`: a chord lifts, so Enter and Space still activate).
 * The other tabs slide aside while one is dragged; the order only
 * changes in the model on drop.
 *
 * More tabs than fit wrap onto more rows, or, as the desktop prefs say
 * (`tabOverflow`, chosen from a tab's menu), scroll the one row
 * sideways. Wrapped, the tabs are a grid to dnd-kit — its rect
 * strategy, free to move across rows; in one row, a horizontal list.
 */
export function TabStrip({
  ids,
  onMove,
  children,
}: {
  ids: readonly string[];
  onMove: (id: string, targetId: string, side: 'before' | 'after') => void;
  children: ReactNode;
}) {
  const wrap = useDesktopPrefs().tabOverflow === 'wrap';
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_THRESHOLD_PX },
    }),
    useSensor(ChordKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const id = String(active.id);
    const targetId = String(over.id);
    // Dropped over a tab to its right, it lands after that tab — the
    // slot the others made room for.
    const side = ids.indexOf(id) < ids.indexOf(targetId) ? 'after' : 'before';
    onMove(id, targetId, side);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionsEndingAt(ids.at(-1))}
      modifiers={wrap ? [] : [restrictToHorizontalAxis]}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={[...ids]}
        strategy={wrap ? rectSortingStrategy : horizontalListSortingStrategy}
      >
        <div
          role="tablist"
          aria-label="Open tabs"
          data-overflow={wrap ? 'wrap' : 'scroll'}
          className={cn(
            'flex shrink-0 items-stretch border-b border-border bg-tab',
            wrap
              ? // Every row but the last is ruled off from the one below.
                'flex-wrap [&>[role=tab]]:-mb-px [&>[role=tab]]:border-b'
              : 'h-9 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          )}
        >
          {children}
          <StripEnd />
        </div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * The room after the last tab. Its growth outweighs the tabs', so it
 * takes the last row's room while each full row above is shared out
 * among its tabs. A drop target only for its rect: collisions resolve
 * it to the last tab.
 */
function StripEnd() {
  const { setNodeRef } = useDroppable({ id: END_ID });
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

/**
 * What a tab in `TabStrip` spreads onto its element to be sortable.
 * `label` is what the drag announcements call it; `tabStop` makes it
 * the row's one Tab stop (the arrows move focus within the row).
 *
 * A primary press selects the tab as the button goes down, the way
 * browsers' and editors' tabs do, rather than on release. It runs
 * after the pointer sensor's own `onPointerDown`, which only starts
 * watching the pointer: the tab lifts once it has travelled
 * `DRAG_THRESHOLD_PX`, so a press that becomes a drag has selected the
 * tab it drags.
 */
export function useSortableTab({
  id,
  label,
  tabStop,
  actions,
}: {
  id: string;
  label: string;
  tabStop: boolean;
  actions: TabKeyActions;
}) {
  const reducedMotion = usePrefersReducedMotion();
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
    data: { label },
    attributes: {
      role: 'tab',
      roleDescription: 'sortable tab',
      tabIndex: tabStop ? 0 : -1,
    },
    // `null` turns the slide off; the tabs then jump to their places.
    transition: reducedMotion ? null : undefined,
  });
  return {
    // The tab is its own handle. Naming it the activator also keeps
    // keys on its close button from lifting the tab.
    setNode: (node: HTMLElement | null) => {
      setNodeRef(node);
      setActivatorNodeRef(node);
    },
    props: {
      ...attributes,
      ...listeners,
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        listeners?.onPointerDown?.(e);
        if (selectsOnPress(e)) actions.activate();
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        listeners?.onKeyDown?.(e);
        // The sensor took it (the lift chord), a drag is under way, or
        // the key was meant for the close button inside the tab.
        if (e.defaultPrevented || active || e.target !== e.currentTarget)
          return;
        handleTabKey(e, actions);
      },
    },
    style: { transform: CSS.Translate.toString(transform), transition },
    isDragging,
  };
}
