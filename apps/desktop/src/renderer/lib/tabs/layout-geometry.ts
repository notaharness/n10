import type { Edge } from './layout.js';
import type { LayoutNode, PaneId } from './workspace.js';

/**
 * Where panes sit in the editor's layout tree, relative to each other,
 * and how small a subtree may get: the geometry the pane moves and the
 * editor's minimum sizes read.
 */

/** A pane's place in the editor, in fractions of the whole. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;

/** Where each pane sits, in fractions of the editor. */
export function paneRects(layout: LayoutNode): Map<PaneId, Rect> {
  const rects = new Map<PaneId, Rect>();
  const visit = (node: LayoutNode, r: Rect) => {
    if (node.kind === 'pane') {
      rects.set(node.id, r);
      return;
    }
    let at = 0;
    node.children.forEach((child, i) => {
      const share = node.sizes[i]!;
      visit(
        child,
        node.direction === 'row'
          ? { x: r.x + at * r.w, y: r.y, w: share * r.w, h: r.h }
          : { x: r.x, y: r.y + at * r.h, w: r.w, h: share * r.h }
      );
      at += share;
    });
  };
  visit(layout, { x: 0, y: 0, w: 1, h: 1 });
  return rects;
}

/** How far `b` lies beyond `a`'s `edge` (negative: not wholly past it),
 *  and how much of the side they share. */
function beyond(
  a: Rect,
  b: Rect,
  edge: Edge
): { gap: number; overlap: number } {
  const span = (lo1: number, hi1: number, lo2: number, hi2: number) =>
    Math.min(hi1, hi2) - Math.max(lo1, lo2);
  switch (edge) {
    case 'left':
      return {
        gap: a.x - (b.x + b.w),
        overlap: span(a.y, a.y + a.h, b.y, b.y + b.h),
      };
    case 'right':
      return {
        gap: b.x - (a.x + a.w),
        overlap: span(a.y, a.y + a.h, b.y, b.y + b.h),
      };
    case 'top':
      return {
        gap: a.y - (b.y + b.h),
        overlap: span(a.x, a.x + a.w, b.x, b.x + b.w),
      };
    case 'bottom':
      return {
        gap: b.y - (a.y + a.h),
        overlap: span(a.x, a.x + a.w, b.x, b.x + b.w),
      };
  }
}

const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const distance = (a: Rect, b: Rect) => {
  const p = centre(a);
  const q = centre(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

/**
 * The pane in `edge`'s direction from `from`: of the panes wholly past
 * that side and level with it, the nearest, then the one sharing most of
 * the side, then the first in reading order; with none level, the
 * nearest centre past that side. `null` when nothing lies that way.
 */
export function paneToward(
  layout: LayoutNode,
  from: PaneId,
  edge: Edge
): PaneId | null {
  const rects = paneRects(layout);
  const a = rects.get(from);
  if (!a) return null;
  const past = [...rects]
    .filter(([id]) => id !== from)
    .map(([id, r]) => ({ id, r, ...beyond(a, r, edge) }))
    .filter((c) => c.gap > -EPS);
  const level = past.filter((c) => c.overlap > EPS);
  if (level.length > 0) {
    // Stable sort keeps reading order for the last tie.
    level.sort(
      (p, q) =>
        (Math.abs(p.gap - q.gap) < EPS ? 0 : p.gap - q.gap) ||
        (Math.abs(p.overlap - q.overlap) < EPS ? 0 : q.overlap - p.overlap)
    );
    return level[0]!.id;
  }
  past.sort((p, q) => distance(a, p.r) - distance(a, q.r));
  return past[0]?.id ?? null;
}

const EDGE_ORDER: readonly Edge[] = ['left', 'right', 'top', 'bottom'];

/** The midpoint of `a`'s `edge`. */
function edgeMid(a: Rect, edge: Edge): { x: number; y: number } {
  const c = centre(a);
  if (edge === 'left') return { x: a.x, y: c.y };
  if (edge === 'right') return { x: a.x + a.w, y: c.y };
  if (edge === 'top') return { x: c.x, y: a.y };
  return { x: c.x, y: a.y + a.h };
}

/** The midpoint of the stretch of `edge` that `a` and `b` share. */
function sharedMid(a: Rect, b: Rect, edge: Edge): { x: number; y: number } {
  const m = edgeMid(a, edge);
  if (edge === 'left' || edge === 'right') {
    const lo = Math.max(a.y, b.y);
    const hi = Math.min(a.y + a.h, b.y + b.h);
    return { x: m.x, y: (lo + hi) / 2 };
  }
  const lo = Math.max(a.x, b.x);
  const hi = Math.min(a.x + a.w, b.x + b.w);
  return { x: (lo + hi) / 2, y: m.y };
}

/**
 * The pane that takes a closed pane's tabs: of the panes touching it,
 * the one whose shared stretch of edge is centred nearest that edge's
 * middle (ties: left, right, above, below, then reading order); with
 * none touching, the nearest centre.
 */
export function closeNeighbour(layout: LayoutNode, id: PaneId): PaneId | null {
  const rects = paneRects(layout);
  const a = rects.get(id);
  if (!a) return null;
  const touching: { id: PaneId; d: number; side: number }[] = [];
  for (const [other, r] of rects) {
    if (other === id) continue;
    EDGE_ORDER.forEach((edge, side) => {
      const { gap, overlap } = beyond(a, r, edge);
      if (Math.abs(gap) > EPS || overlap <= EPS) return;
      const p = sharedMid(a, r, edge);
      const q = edgeMid(a, edge);
      touching.push({ id: other, d: Math.hypot(p.x - q.x, p.y - q.y), side });
    });
  }
  if (touching.length > 0) {
    touching.sort(
      (p, q) => (Math.abs(p.d - q.d) < EPS ? 0 : p.d - q.d) || p.side - q.side
    );
    return touching[0]!.id;
  }
  const rest = [...rects].filter(([other]) => other !== id);
  rest.sort(([, p], [, q]) => distance(a, p) - distance(a, q));
  return rest[0]?.[0] ?? null;
}

/** The smallest a pane may be, strip included, and a separator's room. */
export const MIN_PANE = { width: 240, height: 180 } as const;
export const SEPARATOR_PX = 4;

/**
 * The least room `node` needs along `axis`, in pixels: a pane its
 * minimum; a split along that axis its children's sum and separators,
 * across it its largest child's.
 */
export function minExtent(node: LayoutNode, axis: 'width' | 'height'): number {
  if (node.kind === 'pane') return MIN_PANE[axis];
  const along = (node.direction === 'row') === (axis === 'width');
  const each = node.children.map((c) => minExtent(c, axis));
  return along
    ? each.reduce((a, b) => a + b, 0) + SEPARATOR_PX * (each.length - 1)
    : Math.max(...each);
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
