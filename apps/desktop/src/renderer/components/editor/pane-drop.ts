import { MIN_PANE, SEPARATOR_PX, type Edge } from '../../lib/tabs/layout.js';

/**
 * Where a tab dragged over a pane's content lands: on one of its sides,
 * splitting the pane, or in the middle, moving into it. Pure, over the
 * content's rectangle and the pointer.
 */
export type DropZone = Edge | 'centre';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How deep a side's band reaches in: a fifth of the pane, between 24
 *  and 80 pixels. */
const band = (size: number) => Math.min(80, Math.max(24, size * 0.2));

const ORDER: readonly Edge[] = ['left', 'right', 'top', 'bottom'];

/** The zone the pointer at (`x`, `y`) is over. In a corner, two bands
 *  meet: the side nearer in proportion to the pane wins, ties going
 *  left, right, top, bottom. */
export function zoneAt(box: Box, x: number, y: number): DropZone {
  const reach = {
    left: { d: x - box.left, size: box.width },
    right: { d: box.left + box.width - x, size: box.width },
    top: { d: y - box.top, size: box.height },
    bottom: { d: box.top + box.height - y, size: box.height },
  };
  let best: { edge: Edge; at: number } | null = null;
  for (const edge of ORDER) {
    const { d, size } = reach[edge];
    if (d < 0 || d >= band(size)) continue;
    const at = d / size;
    if (!best || at < best.at) best = { edge, at };
  }
  return best?.edge ?? 'centre';
}

/** Whether a pane of `frame`'s size has room for two panes side by side
 *  across `edge`'s axis. */
export function canSplit(
  frame: { width: number; height: number },
  edge: Edge
): boolean {
  return edge === 'left' || edge === 'right'
    ? frame.width >= 2 * MIN_PANE.width + SEPARATOR_PX
    : frame.height >= 2 * MIN_PANE.height + SEPARATOR_PX;
}

/** The half of the content a split on `edge` would give the dropped
 *  tab, as fractions for the highlight. */
export function zoneArea(zone: DropZone): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  const half = '50%';
  const all = '100%';
  switch (zone) {
    case 'left':
      return { left: '0', top: '0', width: half, height: all };
    case 'right':
      return { left: half, top: '0', width: half, height: all };
    case 'top':
      return { left: '0', top: '0', width: all, height: half };
    case 'bottom':
      return { left: '0', top: half, width: all, height: half };
    case 'centre':
      return { left: '0', top: '0', width: all, height: all };
  }
}

export const ZONE_LABEL: Record<DropZone, string> = {
  left: 'Split left',
  right: 'Split right',
  top: 'Split up',
  bottom: 'Split down',
  centre: 'Move here',
};
