import type { Active, Announcements, Over } from '@dnd-kit/core';
import { isStripDragData } from './strip-drag.js';

/** A tab as a screen reader hears it: its label, not its id. */
function spoken(target: Active | Over): string {
  const data = target.data.current;
  return isStripDragData(data) ? data.label : String(target.id);
}

/** Where a place stands among those the drag may land on. */
function position(over: Over): string | undefined {
  const sortable = (
    over.data.current as
      | { sortable?: { index: number; items: unknown[] } }
      | undefined
  )?.sortable;
  return sortable
    ? `Position ${sortable.index + 1} of ${sortable.items.length}.`
    : undefined;
}

export const stripAnnouncements: Announcements = {
  onDragStart: ({ active }) => `Moving ${spoken(active)}.`,
  onDragOver: ({ over }) => (over ? position(over) : undefined),
  onDragEnd: ({ active, over }) =>
    over ? `Moved ${spoken(active)}.` : 'Move cancelled.',
  onDragCancel: () => 'Move cancelled.',
};
