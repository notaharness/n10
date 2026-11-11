import type { LayoutNode, PaneId, PaneNode, SplitNode } from './workspace.js';

/**
 * The editor's layout tree as pure data: splitting a pane, taking one
 * out, and where panes sit relative to each other. The invariants every
 * function here keeps (`tabs.properties.spec.ts`): a split has two or
 * more children and sizes summing to 1, and no split holds a child
 * split of its own direction (that child's panes are its own).
 */

/** A side of a pane, and a direction to move from it. */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

/** A pane's place in the editor, in fractions of the whole. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;

/** Every pane in the layout, in reading order. */
export function panesOf(layout: LayoutNode): PaneNode[] {
  return layout.kind === 'pane' ? [layout] : layout.children.flatMap(panesOf);
}

export function firstPane(node: LayoutNode): PaneId {
  return node.kind === 'pane' ? node.id : firstPane(node.children[0]!);
}

/** A name for a split that no other split shares: its children's first
 *  panes, each in one child only. It changes when the children do. */
export function splitKey(node: SplitNode): string {
  return node.children.map(firstPane).join('|');
}

/** The id for a pane added to `layout`: one past the highest number in
 *  use, so it is the same however often the reducer runs. */
export function nextPaneId(layout: LayoutNode): PaneId {
  const used = panesOf(layout).map(
    (p) => Number(/^pane-(\d+)$/.exec(p.id)?.[1] ?? 0) || 0
  );
  return `pane-${Math.max(0, ...used) + 1}`;
}

/** Sizes scaled to sum to 1; equal shares when they cannot be. */
export function normalSizes(sizes: readonly number[], n: number): number[] {
  const usable =
    sizes.length === n && sizes.every((s) => Number.isFinite(s) && s > 0);
  if (!usable) return Array.from({ length: n }, () => 1 / n);
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((s) => s / sum);
}

export function replacePane(
  node: LayoutNode,
  id: PaneId,
  next: PaneNode
): LayoutNode {
  if (node.kind === 'pane') return node.id === id ? next : node;
  return {
    ...node,
    children: node.children.map((c) => replacePane(c, id, next)),
  };
}

/** A split of `children` with `sizes`, flattened and collapsed: a lone
 *  child stands for the split, and a child split running the same way
 *  hands its children up, sharing out its size. */
export function makeSplit(
  direction: SplitNode['direction'],
  children: readonly LayoutNode[],
  sizes: readonly number[]
): LayoutNode {
  const shares = normalSizes(sizes, children.length);
  const flat: LayoutNode[] = [];
  const flatSizes: number[] = [];
  children.forEach((child, i) => {
    if (child.kind === 'split' && child.direction === direction) {
      child.children.forEach((c, j) => {
        flat.push(c);
        flatSizes.push(shares[i]! * child.sizes[j]!);
      });
      return;
    }
    flat.push(child);
    flatSizes.push(shares[i]!);
  });
  if (flat.length === 1) return flat[0]!;
  return {
    kind: 'split',
    direction,
    children: flat,
    sizes: normalSizes(flatSizes, flat.length),
  };
}

/**
 * The layout with only the panes `keep` accepts, the rest taken out and
 * their room given to their siblings. Never empty: when nothing would be
 * left, the first pane stays.
 */
export function prunePanes(
  layout: LayoutNode,
  keep: (pane: PaneNode) => boolean
): LayoutNode {
  const pruned = prune(layout, keep);
  return pruned ?? panesOf(layout)[0]!;
}

function prune(
  node: LayoutNode,
  keep: (pane: PaneNode) => boolean
): LayoutNode | null {
  if (node.kind === 'pane') return keep(node) ? node : null;
  const kept: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((c, i) => {
    const next = prune(c, keep);
    if (next) {
      kept.push(next);
      sizes.push(node.sizes[i] ?? 0);
    }
  });
  if (kept.length === 0) return null;
  const same =
    kept.length === node.children.length &&
    kept.every((c, i) => c === node.children[i]);
  return same ? node : makeSplit(node.direction, kept, sizes);
}

export function removePane(layout: LayoutNode, id: PaneId): LayoutNode {
  return prunePanes(layout, (p) => p.id !== id);
}

const AXIS: Record<Edge, SplitNode['direction']> = {
  left: 'row',
  right: 'row',
  top: 'column',
  bottom: 'column',
};

/**
 * `added` beside pane `target`, on its `edge`, taking half of the
 * target's room. Beside a sibling in a split running that way, it joins
 * that split; otherwise the target becomes a split of the two.
 */
export function insertBeside(
  layout: LayoutNode,
  target: PaneId,
  edge: Edge,
  added: PaneNode
): LayoutNode {
  const direction = AXIS[edge];
  const before = edge === 'left' || edge === 'top';
  const visit = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      if (node.id !== target) return node;
      return makeSplit(
        direction,
        before ? [added, node] : [node, added],
        [0.5, 0.5]
      );
    }
    const at = node.children.findIndex(
      (c) => c.kind === 'pane' && c.id === target
    );
    if (at < 0 || node.direction !== direction) {
      const children = node.children.map(visit);
      return makeSplit(node.direction, children, node.sizes);
    }
    const half = node.sizes[at]! / 2;
    const children = [...node.children];
    const sizes = [...node.sizes];
    children.splice(before ? at : at + 1, 0, added);
    sizes.splice(at, 1, half, half);
    return makeSplit(direction, children, sizes);
  };
  return visit(layout);
}

/** The split `key` names with new sizes; the same layout when none
 *  matches or the sizes do not fit it. */
export function resizeSplit(
  layout: LayoutNode,
  key: string,
  sizes: readonly number[]
): LayoutNode {
  if (layout.kind === 'pane') return layout;
  if (splitKey(layout) === key) {
    if (sizes.length !== layout.children.length) return layout;
    const next = normalSizes(sizes, sizes.length);
    const same = next.every((s, i) => Math.abs(s - layout.sizes[i]!) < EPS);
    return same ? layout : { ...layout, sizes: next };
  }
  const children = layout.children.map((c) => resizeSplit(c, key, sizes));
  return children.every((c, i) => c === layout.children[i])
    ? layout
    : { ...layout, children };
}

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
