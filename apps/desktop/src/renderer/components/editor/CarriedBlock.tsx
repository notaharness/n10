import { DragOverlay, useDndContext } from '@dnd-kit/core';
import { Folder } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useCarriedOut } from './drag-preview.js';
import { isStripDragData } from './strip-drag.js';

/**
 * The copy of a tab, or of a group's chip, that follows the pointer once
 * it is carried out of its strip (`drag-preview.ts`): over another pane,
 * its strip, or its sides. Portalled to the body, so no pane's overflow
 * or container clips it. Nothing while the drag stays in its strip: the
 * tab itself moves there.
 */
export function CarriedBlock() {
  const out = useCarriedOut();
  const data = useDndContext().active?.data.current;
  const carried = out && isStripDragData(data) ? data : null;
  const count = carried?.kind === 'block' ? carried.ids.length : 1;
  // Mounted only while carried out: dnd-kit counts an overlay as shown
  // once it is mounted, children or not, and the tab then stops moving.
  if (!carried) return null;
  return createPortal(
    // As big as what it copies, as the slot it opens is.
    <DragOverlay dropAnimation={null}>
      <div
        data-drag-overlay
        className="flex h-full w-full cursor-grabbing items-center gap-2 rounded-md border border-primary bg-tab-active px-3 text-sm text-foreground shadow-lg"
      >
        {count > 1 && <Folder aria-hidden className="size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{carried.label}</span>
        {count > 1 && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </div>
    </DragOverlay>,
    document.body
  );
}
