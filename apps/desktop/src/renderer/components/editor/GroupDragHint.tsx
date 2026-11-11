import { useDndMonitor, type Active } from '@dnd-kit/core';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { isStripDragData } from './strip-drag.js';

interface Point {
  x: number;
  y: number;
}

const outside = (p: Point, r: DOMRect) =>
  p.x < r.left || p.x > r.right || p.y < r.top || p.y > r.bottom;

/**
 * Said under a group while one of its members is carried outside it:
 * the slot the strip keeps open is at that end of the group, because a
 * member moves only among its group's members. The pointer is read from
 * the document: dnd-kit's drag delta is the tab's, held inside its
 * group.
 */
export function GroupDragHint({
  group,
  node,
}: {
  group: string;
  node: RefObject<HTMLElement | null>;
}) {
  const [dragging, setDragging] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const mine = (active: Active) => {
    const data = active.data.current;
    return (
      isStripDragData(data) && data.kind === 'member' && data.group === group
    );
  };
  const stop = () => {
    setDragging(false);
    setAt(null);
  };
  useDndMonitor({
    onDragStart: ({ active }) => setDragging(mine(active)),
    onDragEnd: stop,
    onDragCancel: stop,
  });
  const shown = useRef(false);
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const rect = node.current?.getBoundingClientRect();
      const out = !!rect && outside({ x: e.clientX, y: e.clientY }, rect);
      if (out === shown.current) return;
      shown.current = out;
      setAt(out && rect ? { left: rect.left, top: rect.bottom + 4 } : null);
    };
    document.addEventListener('pointermove', move, true);
    return () => {
      document.removeEventListener('pointermove', move, true);
      shown.current = false;
    };
  }, [dragging, node]);
  if (!at) return null;
  return (
    <div
      role="status"
      data-group-drag-hint
      style={at}
      className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
    >
      Tabs stay in their group
    </div>
  );
}
