/**
 * What the strip drags, and where it may land: a block (a group dragged
 * by its chip, or a tab standing alone) moves between other blocks, a
 * pinned tab only among the pinned and anything else only outside them.
 * A group's members are never on the strip; they move through their
 * roster rows' menus. Illegal places
 * are not drop targets at all (`useSortable`'s `disabled.droppable`), so
 * the pointer and the keyboard both meet only legal slots, and the slot
 * the strip opens is the one the drop takes: a block's drop arranges the
 * whole strip as it was presented, with the block moved, so it lands
 * where it showed whatever order the tabs are stored in.
 */

export interface StripDragData {
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
  /** The pane whose strip it is on. */
  pane?: string;
}

/** A place as its caller describes it; the strip adds the label. */
export type StripPlace = Omit<StripDragData, 'label' | 'pane'>;

/** The tabs a drag carries. */
export function draggedIds(dragged: StripDragData): readonly string[] {
  return dragged.ids;
}

export function isStripDragData(data: unknown): data is StripDragData {
  return (data as { kind?: unknown } | undefined)?.kind === 'block';
}

/** Whether `target` is a place `dragged` may land. */
export function acceptsDrop(
  target: StripDragData,
  dragged: StripDragData | undefined
): boolean {
  return !dragged || !target.pinned === !dragged.pinned;
}

/** The strip's blocks as presented, each one's tabs. */
export type StripBlocks = readonly (readonly string[])[];

/** What a drop does: a block's tabs beside another pane's block, or the
 *  strip's tabs in a new order. */
export type StripDrop =
  | {
      kind: 'move';
      ids: readonly string[];
      targetId: string;
      side: 'before' | 'after';
    }
  | { kind: 'arrange'; ids: string[] };

const samePane = (a: StripDragData, b: StripDragData) =>
  (a.pane ?? '') === (b.pane ?? '');

/** A block dropped on another pane's block: its tabs go beside that
 *  block there (the reducer moves them across, `workspace-reduce.ts`). */
function beside(
  dragged: StripDragData,
  over: StripDragData,
  side: 'before' | 'after' = 'before'
): StripDrop | null {
  const targetId = side === 'after' ? over.ids.at(-1) : over.ids[0];
  return targetId ? { kind: 'move', ids: dragged.ids, targetId, side } : null;
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
  if (!samePane(dragged, over)) return beside(dragged, over, pointerSide);
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
