/**
 * What the strip drags, and where it may land: a block (a group dragged
 * by its chip, or a tab standing alone) moves between other blocks, a
 * pinned tab only among the pinned and anything else only outside them.
 * A group's members are never on the strip: a roster row moves its tab
 * among the group's other rows, or out to another pane's strip or a
 * pane's side, never onto its own pane's strip, where its group would
 * gather it back. Illegal places
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
  /** A roster row: the key of the group whose roster lists it. */
  row?: string;
}

/** A place as its caller describes it; the strip adds the label. */
export type StripPlace = Omit<StripDragData, 'label' | 'pane'>;

export function isStripDragData(data: unknown): data is StripDragData {
  return (data as { kind?: unknown } | undefined)?.kind === 'block';
}

/** Whether `target` is a place `dragged` may land. */
export function acceptsDrop(
  target: StripDragData,
  dragged: StripDragData | undefined
): boolean {
  if (!dragged) return true;
  if (dragged.row !== undefined)
    return target.row === undefined
      ? !samePane(dragged, target) && !target.pinned
      : target.row === dragged.row && samePane(dragged, target);
  if (target.row !== undefined) return false;
  return !target.pinned === !dragged.pinned;
}

/** The strip's blocks as presented, each one's tabs. */
export type StripBlocks = readonly (readonly string[])[];

/** What a drop does: a block's tabs beside another pane's block, or the
 *  strip's tabs in a new order. A move into another pane carries that
 *  pane's whole presented order with the tabs in place (`order`) when
 *  its strip is known, so they land where its slot showed. */
export type StripDrop =
  | {
      kind: 'move';
      ids: readonly string[];
      targetId: string;
      side: 'before' | 'after';
      order?: string[];
    }
  | { kind: 'arrange'; ids: string[] };

const samePane = (a: StripDragData, b: StripDragData) =>
  (a.pane ?? '') === (b.pane ?? '');

/** A block dropped on another pane's block: its tabs go beside that
 *  block there (the reducer moves them across, `workspace-reduce.ts`),
 *  in that strip as presented (`blocks`, its blocks) when it is known
 *  and still the one the drag saw. */
function beside(
  dragged: StripDragData,
  over: StripDragData,
  side: 'before' | 'after' = 'before',
  blocks?: StripBlocks
): StripDrop | null {
  const targetId = side === 'after' ? over.ids.at(-1) : over.ids[0];
  if (!targetId) return null;
  const move = { kind: 'move' as const, ids: dragged.ids, targetId, side };
  if (!blocks || !sameIds(blocks[over.index], over.ids)) return move;
  const carried = new Set(dragged.ids);
  const order: (readonly string[])[] = blocks.map((b) =>
    b.filter((id) => !carried.has(id))
  );
  order.splice(over.index + (side === 'after' ? 1 : 0), 0, dragged.ids);
  return { ...move, order: order.flat() };
}

/** The move a drop makes. `null` for a drop on itself, nowhere legal, or
 *  from a strip that has changed under the drag. `blocks` are the
 *  dragged block's pane's, as presented. Onto another pane's block
 *  (whose strip's blocks are `overBlocks`), the tabs land on the side of
 *  it the pointer is on (`pointerSide`, before when unknown): positions
 *  in two strips say nothing of each other. */
export function dropMove(
  activeId: string,
  dragged: StripDragData,
  overId: string,
  over: StripDragData,
  blocks: StripBlocks,
  pointerSide?: 'before' | 'after',
  overBlocks?: StripBlocks
): StripDrop | null {
  if (activeId === overId || !acceptsDrop(over, dragged)) return null;
  if (!samePane(dragged, over))
    return beside(dragged, over, pointerSide, overBlocks);
  if (dragged.row !== undefined) return rowMove(dragged, over, blocks);
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

/** A roster row dropped on another of its group's rows: its tab goes
 *  beside that row's, after it when it came from above, before when
 *  from below, in the strip as presented (`blocks`). */
function rowMove(
  dragged: StripDragData,
  over: StripDragData,
  blocks: StripBlocks
): StripDrop | null {
  const [id] = dragged.ids;
  const [target] = over.ids;
  const order = blocks.flat();
  if (!id || !target || !order.includes(id) || !order.includes(target))
    return null;
  const rest = order.filter((t) => t !== id);
  const at = rest.indexOf(target) + (dragged.index < over.index ? 1 : 0);
  rest.splice(at, 0, id);
  return { kind: 'arrange', ids: rest };
}
