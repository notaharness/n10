import { useDndContext } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useContext, useRef } from 'react';
import { PaneScopeContext } from '../../lib/tabs/tabs.js';
import { useSlotStyle } from './drag-preview.js';
import {
  acceptsDrop,
  isStripDragData,
  type StripDragData,
} from './strip-drag.js';
import type { TabFace } from './use-strip-groups.js';

/** A roster row's sortable id: the tab's, in `pane`, apart from the
 *  strip's blocks. */
export const rosterRowId = (pane: string, tabId: string) =>
  `row:${pane}:${tabId}`;

/**
 * A row of `group`'s roster as a sortable place (`strip-drag.ts`): its
 * tab, at `index` among the rows, in the pane the roster's chip is on.
 * The click a drop ends in is no press (`justDropped`).
 */
export function useRosterRowDrag(group: string, face: TabFace, index: number) {
  const pane = useContext(PaneScopeContext) ?? '';
  const id = rosterRowId(pane, face.tab.id);
  const slot = useSlotStyle(id);
  const dragging = useDndContext().active?.data.current;
  const data: StripDragData = {
    kind: 'block',
    label: face.label,
    ids: [face.tab.id],
    index,
    pane,
    row: group,
  };
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data,
    // Only its own group's rows take a row: a strip drag (a roster held
    // open by the keyboard) meets none of them.
    disabled: {
      droppable: !acceptsDrop(
        data,
        isStripDragData(dragging) ? dragging : undefined
      ),
    },
  });
  const dropped = useRef(false);
  return {
    setNode: setNodeRef,
    handle: {
      // A button already: its role and focus stay its own.
      'aria-roledescription': 'movable tab row',
      'aria-describedby': attributes['aria-describedby'],
      ...listeners,
      onPointerUp: () => {
        // Moved far enough to drag: the click that follows is the drop's.
        dropped.current = isDragging;
        setTimeout(() => (dropped.current = false), 0);
      },
    },
    style: {
      position: 'relative' as const,
      zIndex: isDragging ? 10 : undefined,
      ...slot(isDragging, CSS.Translate.toString(transform), transition),
    },
    justDropped: () => dropped.current,
  };
}
