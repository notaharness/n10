import { useDndContext, useDroppable } from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  useContext,
  useLayoutEffect,
  useMemo,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useDesktopPrefs } from '../../lib/desktop-prefs.js';
import { useSlotStyle } from './drag-preview.js';
import { groupEndId, stripEndId } from './strip-collisions.js';
import { StripBlocksReport } from './strip-blocks.js';
import { StripScrollArrows } from './StripScrollArrows.js';
import {
  useActiveTabInView,
  useStripScrollEdges,
} from './use-strip-scroll-edges.js';
import {
  acceptsDrop,
  isStripDragData,
  type StripDragData,
} from './strip-drag.js';
import { PaneScopeContext, useTabs } from '../../lib/tabs/tabs.js';
import { usePrefersReducedMotion } from '../../lib/reduced-motion.js';
import { cn } from '../../lib/utils.js';
import { handleTabKey, type TabKeyActions } from './tab-keyboard.js';

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
  onBlankMenu,
}: {
  /** Each block's sortable id and its tabs, in strip order. */
  blocks: readonly { id: string; ids: readonly string[] }[];
  children: ReactNode;
  controls: ReactNode;
  /** The native menu of the strip's blank room, past and between tabs:
   *  a tab's own menu has already been shown for a press on a tab. */
  onBlankMenu?: () => void;
}) {
  const wrap = useDesktopPrefs().tabOverflow === 'wrap';
  const pane = useContext(PaneScopeContext) ?? '';
  const report = useContext(StripBlocksReport);
  useLayoutEffect(
    () =>
      report(
        pane,
        blocks.map((b) => b.ids)
      ),
    [report, pane, blocks]
  );
  const blockKey = blocks.map((block) => block.id).join('\n');
  const blockIds = useMemo(() => blockKey.split('\n'), [blockKey]);
  const { track, edges, update } = useStripScrollEdges(blockKey, wrap);
  useActiveTabInView(track, wrap, useTabs().activeId, blockKey);
  return (
    <SortableContext
      items={blockIds}
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
                // At most ten rows, or 70% of the pane if less: past
                // that the strip scrolls and the pane keeps some content.
                // The last row's rule sits in the track's bottom pixel,
                // laid over the strip's own, so one row never scrolls.
                '-mb-px max-h-[min(calc(10*2.25rem+9*0.5rem+1px),70cqh)] flex-wrap overflow-y-auto pb-px [scrollbar-width:thin] [&>*]:-mb-px [&>*]:border-b [&>*]:border-border'
              : 'h-9 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          )}
          onScroll={update}
          onContextMenu={(e) => {
            if (e.defaultPrevented || !onBlankMenu) return;
            e.preventDefault();
            onBlankMenu();
          }}
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
  const itemsKey = ids.join('\n');
  const items = useMemo(() => itemsKey.split('\n'), [itemsKey]);
  return (
    <SortableContext
      items={items}
      strategy={wrap ? rectSortingStrategy : horizontalListSortingStrategy}
    >
      {children}
    </SortableContext>
  );
}

/**
 * The room after the last tab. Its growth outweighs the tabs', so it
 * takes the last row's remaining room; plain flex-wrap keeps each tab
 * at its natural width. A drop target only for its rect, and only under the
 * pointer: collisions resolve it to the last place the drag may land
 * (`strip-collisions.ts`), and a keyboard drag, which steps from
 * droppable to droppable, skips it.
 */
function StripEnd() {
  const { active, activatorEvent } = useDndContext();
  const pane = useContext(PaneScopeContext) ?? '';
  const { setNodeRef } = useDroppable({
    id: stripEndId(pane),
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
  const pane = useContext(PaneScopeContext) ?? '';
  const dragged = active?.data.current;
  const { setNodeRef } = useDroppable({
    id: groupEndId(pane, group),
    disabled:
      activatorEvent instanceof KeyboardEvent ||
      !isStripDragData(dragged) ||
      dragged.kind !== 'member' ||
      dragged.group !== group,
  });
  return <div ref={setNodeRef} aria-hidden className="grow-[9999] basis-0" />;
}

/** A place's data with the pane whose strip it is on, outside the
 *  panes none. */
function inPane(data: StripDragData, pane: string | null): StripDragData {
  return pane === null ? data : { ...data, pane };
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
 * `DRAG_THRESHOLD_PX` (`TabDragProvider`), so a press that becomes a
 * drag has selected the tab it drags. A group's home tab, whose drag moves the whole group,
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
  const pane = useContext(PaneScopeContext);
  const dragging = useDndContext().active?.data.current;
  const slot = useSlotStyle(id);
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
    data: inPane(data, pane),
    disabled: {
      draggable: fixed,
      droppable:
        fixed ||
        !acceptsDrop(
          inPane(data, pane),
          isStripDragData(dragging) ? dragging : undefined
        ),
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
    style: slot(isDragging, CSS.Translate.toString(transform), transition),
    isDragging,
  };
}
