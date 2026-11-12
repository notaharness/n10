import { cn } from '../../lib/utils.js';
import { tabStateClassName } from './tab-marks.js';

/**
 * The class names a tab and a chip are drawn with, shared by the strip
 * and the copy that follows the pointer out of it (`CarriedOverlay`).
 */

export const CHIP_BODY =
  'flex h-full min-w-0 items-center gap-1.5 pr-1 text-[13px] leading-5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset';

/** A chip's frame, in the active colours when its group holds the
 *  active tab. */
export function chipClassName(containsActive: boolean): string {
  return cn(
    'group/chip relative my-0.5 flex h-8 shrink-0 items-center self-center overflow-hidden rounded-md border border-border transition-colors',
    containsActive
      ? 'bg-tab-active text-foreground'
      : 'bg-tab text-muted-foreground hover:bg-tab-hover hover:text-foreground'
  );
}

export function tabClassName({
  active,
  unseen,
  dragging,
  flashing,
  wrap,
  pinned,
}: {
  active: boolean;
  unseen: boolean;
  dragging: boolean;
  flashing: boolean;
  wrap: boolean;
  pinned: boolean;
}): string {
  return cn(
    'group relative flex h-9 min-w-28 cursor-default items-center gap-2 border-r border-border px-3 text-base transition-colors select-none',
    // A pin is narrower, 112–176px, wrapped or not, and its mark sits in
    // the close button's place, so it needs no room for one. Wrapped, the
    // other tabs of a full row share its width (TabStrip's end, or a
    // group's, takes the last row's room); in one row, each keeps its own.
    pinned ? 'max-w-44 shrink-0 pr-1.5' : wrap ? 'grow' : 'max-w-56 shrink-0',
    // Lifted above the tabs it slides over.
    dragging && 'z-10',
    tabStateClassName({ active, unseen, flashing })
  );
}
