import { cn } from '../../lib/utils.js';
import { tabStateClassName } from './tab-marks.js';

/**
 * The class names a tab and a chip are drawn with, shared by the strip
 * and the copy that follows the pointer out of it (`CarriedOverlay`).
 */

/** A chip is drawn as a tab is: the active tab's colours while its
 *  group holds the active tab, blinking while its group has news
 *  (`chipSignal`). */
export function chipClassName({
  containsActive,
  flashing,
  dragging,
  wrap,
}: {
  containsActive: boolean;
  flashing: boolean;
  dragging: boolean;
  wrap: boolean;
}): string {
  return cn(
    tabClassName({
      active: containsActive,
      unseen: false,
      dragging,
      flashing,
      wrap,
      pinned: false,
    }),
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
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
