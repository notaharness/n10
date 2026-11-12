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

/** The id for a split added to `layout`, as `nextPaneId` for panes. */
export function nextSplitId(layout: LayoutNode): string {
  const used: number[] = [];
  const visit = (n: LayoutNode) => {
    if (n.kind === 'pane') return;
    used.push(Number(/^split-(\d+)$/.exec(n.id)?.[1] ?? 0) || 0);
    n.children.forEach(visit);
  };
  visit(layout);
  return `split-${Math.max(0, ...used) + 1}`;
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
  sizes: readonly number[],
  id: string
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
    id,
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
  return same ? node : makeSplit(node.direction, kept, sizes, node.id);
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
  const fresh = nextSplitId(layout);
  const visit = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      if (node.id !== target) return node;
      return makeSplit(
        direction,
        before ? [added, node] : [node, added],
        [0.5, 0.5],
        fresh
      );
    }
    const at = node.children.findIndex(
      (c) => c.kind === 'pane' && c.id === target
    );
    if (at < 0 || node.direction !== direction) {
      const children = node.children.map(visit);
      return makeSplit(node.direction, children, node.sizes, node.id);
    }
    const half = node.sizes[at]! / 2;
    const children = [...node.children];
    const sizes = [...node.sizes];
    children.splice(before ? at : at + 1, 0, added);
    sizes.splice(at, 1, half, half);
    return makeSplit(direction, children, sizes, node.id);
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
