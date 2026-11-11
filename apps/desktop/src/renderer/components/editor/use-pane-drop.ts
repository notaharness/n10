import { useEffect } from 'react';
import { useDndContext, useDroppable, type DragEndEvent } from '@dnd-kit/core';
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
import type { Edge } from '../../lib/tabs/layout.js';
import { NO_ROOM } from '../../lib/tabs/pane-commands.js';
import { rebuildsLayout } from '../../lib/tabs/pane-moves.js';
import { showPreview, type StripBox } from './drag-preview.js';
import { canSplit, zoneAt } from './pane-drop.js';
import { paneFrame, revealFocusedPane } from './reveal-tab.js';
import { draggedIds, isStripDragData } from './strip-drag.js';

/**
 * A tab or group dragged from a strip onto a pane's content: a side
 * splits the pane, the middle moves into it (`pane-drop.ts`). The
 * content is one droppable per pane, enabled for pointer drags only;
 * the zone is read from the pointer, and the pane draws its highlight
 * from `pane-drop-target.ts`.
 */

const PREFIX = 'pane-zone:';

export function isPaneZone(id: unknown): boolean {
  return String(id).startsWith(PREFIX);
}

/** What a drag is over, as the drag context last said. */
type Drag = Pick<DragEndEvent, 'active' | 'over'>;

/**
 * Where the pointer is, and the drag it carries. The strip's modifier
 * keeps a dragged tab inside its strip until it is carried out
 * (`drag-preview.ts`), so the drag's own move events do not follow the
 * pointer everywhere: the pointer's own events do, and each one re-reads
 * the zone under it and what the drag shows.
 */
let pointer: { x: number; y: number } | null = null;

/** Which half of `rect` the pointer is over, left or right: a strip drop
 *  across panes lands on that side. */
export function pointerSide(rect: {
  left: number;
  width: number;
}): 'before' | 'after' {
  return pointer && pointer.x > rect.left + rect.width / 2 ? 'after' : 'before';
}
let following: {
  drag: Drag;
  ws: Workspace;
  /** Where the drag started (`StripBox`). */
  strip: StripBox | null;
} | null = null;

function followPointer(e: PointerEvent) {
  pointer = { x: e.clientX, y: e.clientY };
  if (!following) return;
  show(dropAt(following.drag, following.ws));
  showPreview(following.drag, following.strip, pointer, pointerSide);
}

type DropAt = (PaneDropTarget & { ids: readonly string[] }) | null;

function show(at: DropAt) {
  setPaneDropTarget(
    at && {
      pane: at.pane,
      zone: at.zone,
      allowed: at.allowed,
      ...(at.hint ? { hint: at.hint } : {}),
    }
  );
  document.body.style.cursor = at && !at.allowed ? 'no-drop' : '';
}

/** The zone a drag is over, if it is over a pane's content, and whether
 *  dropping there would do anything: the middle of the pane it came
 *  from would not, nor a side where the pane has no room for two, nor a
 *  split of a pane by every tab it holds. */
function dropAt({ over, active }: Drag, ws: Workspace): DropAt {
  const dragged = active.data.current;
  if (!over || !isPaneZone(over.id) || !isStripDragData(dragged)) return null;
  if (!pointer) return null;
  const pane = String(over.id).slice(PREFIX.length);
  const zone = zoneAt(over.rect, pointer.x, pointer.y);
  const ids = draggedIds(dragged);
  const from = dragged.pane;
  if (zone === 'centre') return { pane, zone, ids, allowed: from !== pane };
  return { pane, zone, ids, ...edgeDrop(ws, pane, zone, ids, from) };
}

/** Whether a drop on `pane`'s `zone` side would split it, and why not. */
function edgeDrop(
  ws: Workspace,
  pane: PaneId,
  zone: Edge,
  ids: readonly string[],
  from: PaneId | undefined
): { allowed: boolean; hint?: string } {
  const order = panesOf(ws.layout).find((p) => p.id === pane)?.order ?? [];
  const emptied = from === pane && order.every((id) => ids.includes(id));
  if (emptied || rebuildsLayout(ws, ids, pane, zone)) return { allowed: false };
  const frame = paneFrame(pane);
  return frame !== null && canSplit(frame, zone)
    ? { allowed: true }
    : { allowed: false, hint: NO_ROOM };
}

/** The drag provider's side of pane drops: following the drag and the
 *  pointer, and the drop. */
export function usePaneDrop() {
  const { workspace } = useWorkspace();
  const panes = usePanes();
  useEffect(() => {
    const opts = { capture: true, passive: true };
    window.addEventListener('pointermove', followPointer, opts);
    window.addEventListener('pointerdown', followPointer, opts);
    return () => {
      window.removeEventListener('pointermove', followPointer, opts);
      window.removeEventListener('pointerdown', followPointer, opts);
    };
  }, []);
  return {
    /** The drag context changed: what is dragged, over what, and the
     *  box of the strip it started in. */
    follow(drag: Drag | null, strip: StripBox | null) {
      following = drag && { drag, ws: workspace, strip };
      show(drag && dropAt(drag, workspace));
      showPreview(drag, strip, pointer, pointerSide);
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
      revealFocusedPane();
      return true;
    },
    clear() {
      following = null;
      show(null);
      showPreview(null, null, null, pointerSide);
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
