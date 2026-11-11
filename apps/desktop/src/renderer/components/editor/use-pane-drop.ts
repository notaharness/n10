import {
  useDndContext,
  useDroppable,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import {
  setPaneDropTarget,
  type PaneDropTarget,
} from '../../lib/tabs/pane-drop-target.js';
import { useWorkspace } from '../../lib/tabs/tabs.js';
import { usePanes } from '../../lib/tabs/use-panes.js';
import {
  panesOf,
  type PaneId,
  type Workspace,
} from '../../lib/tabs/workspace.js';
import { canSplit, zoneAt } from './pane-drop.js';
import { draggedIds, isStripDragData } from './strip-drag.js';

/**
 * A tab or group dragged from a strip onto a pane's content: a side
 * splits the pane, the middle moves into it (`pane-drop.ts`). The
 * content is one droppable per pane, enabled for pointer drags only;
 * the zone is read from the pointer, and the pane draws its highlight
 * from `pane-drop-target.ts`.
 */

const PREFIX = 'pane-zone:';

export const isPaneZone = (id: unknown) => String(id).startsWith(PREFIX);

/** The pane frame on screen, strip included, by its `data-pane-id`. */
function frameOf(pane: PaneId): DOMRect | null {
  return (
    document
      .querySelector(`[data-pane-id="${CSS.escape(pane)}"]`)
      ?.getBoundingClientRect() ?? null
  );
}

/** The zone a drag is over, if it is over a pane's content, and whether
 *  dropping there would do anything: the middle of the pane it came
 *  from would not, nor a side where the pane has no room for two, nor a
 *  split of a pane by every tab it holds. */
function dropAt(
  event: DragMoveEvent | DragEndEvent,
  ws: Workspace
): (PaneDropTarget & { ids: readonly string[] }) | null {
  const { over, active, activatorEvent, delta } = event;
  const dragged = active.data.current;
  if (!over || !isPaneZone(over.id) || !isStripDragData(dragged)) return null;
  if (!(activatorEvent instanceof MouseEvent)) return null;
  const pane = String(over.id).slice(PREFIX.length);
  const zone = zoneAt(
    over.rect,
    activatorEvent.clientX + delta.x,
    activatorEvent.clientY + delta.y
  );
  const ids = draggedIds(String(active.id), dragged);
  const from = dragged.pane;
  if (zone === 'centre') return { pane, zone, ids, allowed: from !== pane };
  const order = panesOf(ws.layout).find((p) => p.id === pane)?.order ?? [];
  const emptied = from === pane && order.every((id) => ids.includes(id));
  const frame = frameOf(pane);
  const roomy = frame !== null && canSplit(frame, zone);
  if (emptied) return { pane, zone, ids, allowed: false };
  return roomy
    ? { pane, zone, ids, allowed: true }
    : { pane, zone, ids, allowed: false, hint: 'Not enough room to split' };
}

/** The drag provider's side of pane drops: following the pointer, and
 *  the drop. */
export function usePaneDrop() {
  const { workspace } = useWorkspace();
  const panes = usePanes();
  const show = (target: PaneDropTarget | null) => {
    setPaneDropTarget(target);
    document.body.style.cursor = target && !target.allowed ? 'no-drop' : '';
  };
  return {
    move(event: DragMoveEvent) {
      const at = dropAt(event, workspace);
      show(
        at && {
          pane: at.pane,
          zone: at.zone,
          allowed: at.allowed,
          ...(at.hint ? { hint: at.hint } : {}),
        }
      );
    },
    /** Whether the drop was onto a pane's content: then it is the
     *  pane's, done or refused, and no strip move. */
    drop(event: DragEndEvent): boolean {
      const at = dropAt(event, workspace);
      if (!at) return false;
      if (!at.allowed) return true;
      const shown = at.ids[0];
      if (at.zone === 'centre') panes.moveToPane(at.ids, at.pane, shown);
      else panes.split(at.ids, at.pane, at.zone, shown);
      return true;
    },
    clear() {
      show(null);
    },
  };
}

/** The droppable over pane `pane`'s content: there only while a tab is
 *  dragged by pointer, never a stop for a keyboard drag. */
export function usePaneZone(pane: PaneId) {
  const { active, activatorEvent } = useDndContext();
  const { setNodeRef } = useDroppable({
    id: `${PREFIX}${pane}`,
    data: { kind: 'pane-zone', pane },
    disabled:
      !isStripDragData(active?.data.current) ||
      activatorEvent instanceof KeyboardEvent,
  });
  return setNodeRef;
}
