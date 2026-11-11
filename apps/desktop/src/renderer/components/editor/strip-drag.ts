/**
 * What the strip drags, and where it may land. A member tab moves only
 * among its own group's members; a block (a group dragged by its chip, or
 * a tab standing alone) moves only between other blocks. Illegal places
 * are not drop targets at all (`useSortable`'s `disabled.droppable`), so
 * the pointer and the keyboard both meet only legal slots, and the slot
 * the strip opens is the one the drop takes.
 */

export type StripDragData =
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
      /** The tabs it carries, in their strip order. */
      ids: readonly string[];
      /** Its place among the blocks, as presented. */
      index: number;
    };

/** A place as its caller describes it; the strip adds the label. */
export type StripPlace =
  | Omit<Extract<StripDragData, { kind: 'member' }>, 'label'>
  | Omit<Extract<StripDragData, { kind: 'block' }>, 'label'>;

export function isStripDragData(data: unknown): data is StripDragData {
  const kind = (data as { kind?: unknown } | undefined)?.kind;
  return kind === 'member' || kind === 'block';
}

/** Whether `target` is a place `dragged` may land. */
export function acceptsDrop(
  target: StripDragData,
  dragged: StripDragData | undefined
): boolean {
  if (!dragged) return true;
  if (dragged.kind === 'block') return target.kind === 'block';
  return target.kind === 'member' && target.group === dragged.group;
}

/** The move a drop makes: the tabs to move, and where. `null` for a drop
 *  on itself or nowhere legal. */
export function dropMove(
  activeId: string,
  dragged: StripDragData,
  overId: string,
  over: StripDragData
): {
  ids: readonly string[];
  targetId: string;
  side: 'before' | 'after';
} | null {
  if (activeId === overId || !acceptsDrop(over, dragged)) return null;
  const side = dragged.index < over.index ? 'after' : 'before';
  if (dragged.kind === 'member')
    return { ids: [activeId], targetId: overId, side };
  if (over.kind !== 'block') return null;
  const targetId = side === 'after' ? over.ids.at(-1) : over.ids[0];
  return targetId ? { ids: dragged.ids, targetId, side } : null;
}
