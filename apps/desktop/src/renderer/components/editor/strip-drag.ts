/**
 * What the strip drags, and where it may land. A member tab moves only
 * among its own group's members; a block (a group dragged by its chip, or
 * a tab standing alone) moves only between other blocks, a pinned tab
 * only among the pinned and anything else only outside them. Illegal places
 * are not drop targets at all (`useSortable`'s `disabled.droppable`), so
 * the pointer and the keyboard both meet only legal slots, and the slot
 * the strip opens is the one the drop takes: a block's drop arranges the
 * whole strip as it was presented, with the block moved, so it lands
 * where it showed whatever order the tabs are stored in.
 */

export type StripDragData = (
  | {
      kind: 'member';
      label: string;
      /** The group's key. */
      group: string;
      /** Its place among the group's members, as presented. */
      index: number;
    }
  | {
      kind: 'block';
      label: string;
      /** The tabs it carries, in their strip order (a group's followers
       *  with it). */
      ids: readonly string[];
      /** Its place among the blocks, as presented. */
      index: number;
      /** A pinned tab: it moves only among the pinned ones, and nothing
       *  else lands among them. */
      pinned?: true;
    }
) & {
  /** The pane whose strip it is on. */
  pane?: string;
};

/** A place as its caller describes it; the strip adds the label. */
export type StripPlace =
  | Omit<Extract<StripDragData, { kind: 'member' }>, 'label' | 'pane'>
  | Omit<Extract<StripDragData, { kind: 'block' }>, 'label' | 'pane'>;

/** The tabs a drag carries: a member its own, a block its ids. */
export function draggedIds(
  activeId: string,
  dragged: StripDragData
): readonly string[] {
  return dragged.kind === 'member' ? [activeId] : dragged.ids;
}

export function isStripDragData(data: unknown): data is StripDragData {
  const kind = (data as { kind?: unknown } | undefined)?.kind;
  return kind === 'member' || kind === 'block';
}

const samePane = (a: StripDragData, b: StripDragData) =>
  (a.pane ?? '') === (b.pane ?? '');

const pinnedPlace = (data: StripDragData) =>
  data.kind === 'block' && !!data.pinned;

/** Whether `target` is a place `dragged` may land. In another pane's
 *  strip a member may land beside a block too (it moves there, and shows
 *  in its group there); a block never lands inside a group. */
export function acceptsDrop(
  target: StripDragData,
  dragged: StripDragData | undefined
): boolean {
  if (!dragged) return true;
  if (target.kind === 'member') {
    return dragged.kind === 'member' && target.group === dragged.group;
  }
  if (dragged.kind === 'member' && samePane(dragged, target)) return false;
  return pinnedPlace(target) === pinnedPlace(dragged);
}

/** The strip's blocks as presented, each one's tabs. */
export type StripBlocks = readonly (readonly string[])[];

/** What a drop does: a member placed among its group's members, or the
 *  strip's tabs in a new order. */
export type StripDrop =
  | {
      kind: 'move';
      ids: readonly string[];
      targetId: string;
      side: 'before' | 'after';
    }
  | { kind: 'arrange'; ids: string[] };

/** Into another pane's strip: beside the place it is over there, a
 *  block by its first or last tab, a member by itself. */
function beside(
  ids: readonly string[],
  overId: string,
  over: StripDragData,
  side: 'before' | 'after' = 'before'
): StripDrop | null {
  const targetId =
    over.kind === 'member'
      ? overId
      : side === 'after'
      ? over.ids.at(-1)
      : over.ids[0];
  return targetId ? { kind: 'move', ids, targetId, side } : null;
}

/** The move a drop makes. `null` for a drop on itself, nowhere legal, or
 *  from a strip that has changed under the drag. `blocks` are the
 *  dragged block's pane's, as presented. Onto another pane's block, the
 *  tabs land on the side of it the pointer is on (`pointerSide`, before
 *  when unknown): positions in two strips say nothing of each other. */
export function dropMove(
  activeId: string,
  dragged: StripDragData,
  overId: string,
  over: StripDragData,
  blocks: StripBlocks,
  pointerSide?: 'before' | 'after'
): StripDrop | null {
  if (activeId === overId || !acceptsDrop(over, dragged)) return null;
  if (!samePane(dragged, over))
    return beside(draggedIds(activeId, dragged), overId, over, pointerSide);
  if (dragged.kind === 'member') {
    // Members show in their stored relative order, so a stored neighbour
    // is the presented one.
    const side = dragged.index < over.index ? 'after' : 'before';
    return { kind: 'move', ids: [activeId], targetId: overId, side };
  }
  if (over.kind !== 'block') return null;
  const from = dragged.index;
  const to = over.index;
  if (from === to || !sameIds(blocks[from], dragged.ids) || !blocks[to])
    return null;
  const order = [...blocks];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  return { kind: 'arrange', ids: order.flat() };
}

function sameIds(
  a: readonly string[] | undefined,
  b: readonly string[]
): boolean {
  return a?.length === b.length && a.every((id, i) => id === b[i]);
}
