import { FolderXIcon, XIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { SidebarItem } from '../../../host/contract.js';
import { itemWorktreeRemoved } from '../../lib/sidebar/sidebar-model.js';
import { cn } from '../../lib/utils.js';

/**
 * The marks a tab carries, shared by the strip's tabs and the player
 * rows an orchestrator tab lists, which are drawn as tabs.
 */

/** A tab's colours in each state. Opaque in every one: the close button
 *  takes the background to cover the end of the label. */
export function tabStateClassName({
  active,
  unseen,
  flashing,
}: {
  active: boolean;
  unseen: boolean;
  flashing: boolean;
}): string {
  return cn(
    active
      ? 'bg-tab-active text-foreground'
      : 'bg-tab text-muted-foreground hover:bg-tab-hover hover:text-foreground',
    unseen && 'text-foreground',
    // The agent finished a work streak and nobody has looked yet.
    flashing && !active && 'tab-attention'
  );
}

/** How many comments this tab's PR has queued in the plan. */
export function PlanCountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} comment${count === 1 ? '' : 's'} in the plan`}
      className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium tabular-nums text-primary"
    >
      {count}
    </span>
  );
}

/** The tab of an agent whose worktree is gone. */
export function RemovedMark({ item }: { item: SidebarItem | undefined }) {
  if (!item || !itemWorktreeRemoved(item)) return null;
  return (
    <span
      aria-label="Worktree removed"
      title="Worktree removed"
      className="flex shrink-0 text-warning"
    >
      <FolderXIcon className="size-3.5" />
    </span>
  );
}

/** A tab that opened in the background and has not been looked at. */
export function UnseenDot() {
  return (
    <span
      aria-label="Not yet opened"
      className="size-1.5 shrink-0 rounded-full bg-primary"
    />
  );
}

/**
 * Always rendered, revealed on hover over the end of the tab, in the
 * tab's own colour: the label keeps the whole width the rest of the
 * time. Out of the Tab order: the row is one Tab stop, and Delete
 * closes the focused tab.
 */
export function TabCloseButton({
  onClose,
  label = 'Close tab',
}: {
  onClose: (e: MouseEvent) => void;
  label?: string;
}) {
  return (
    <span className="absolute inset-y-0 right-0 flex items-center bg-inherit pr-1.5 pl-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        type="button"
        tabIndex={-1}
        onClick={onClose}
        aria-label={label}
        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}

/** The tab's repository, as a band of its colour along the bottom. */
export function RepoBand({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      data-repo-band
      aria-hidden
      className="absolute inset-x-0 bottom-0 h-0.5"
      style={{ backgroundColor: color }}
    />
  );
}
