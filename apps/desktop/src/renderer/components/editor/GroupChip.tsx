import { FolderClosedIcon, FolderOpenIcon } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';
import { toast } from 'sonner';
import { harnessLabel } from '@n10/core/ui';
import { groupSummary } from '../../lib/tabs/group-status.js';
import type { TabGroup, TabStatus } from '../../lib/tabs/tab-groups.js';
import { cn, errorMessage } from '../../lib/utils.js';
import { PopoverAnchor } from '../ui/popover.js';
import { StatusClusters } from './StatusClusters.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import { RepoBand } from './tab-marks.js';
import { TabIcon } from './TabIcon.js';
import { runGroupMenu, type GroupMenu } from './tab-menu.js';
import type { useSortableTab } from './TabStrip.js';
import type { useRosterOpen } from './use-roster-open.js';
import type { TabFace } from './use-strip-groups.js';

type Sortable = ReturnType<typeof useSortableTab>;

/** The chip's tooltip: its name, the active member's whole label, and
 *  for a home what it is and where. */
function chipTitle(
  label: string,
  head: TabFace | null,
  active: TabFace | null
): string {
  const name = active ? `${label} / ${active.label}` : label;
  if (!head) return name;
  const { tab } = head;
  const what =
    head.taskTitle ?? (head.harness ? harnessLabel(head.harness) : 'Agent');
  return [
    name,
    `Orchestrator: ${what}`,
    tab.kind === 'item' ? `Repository: ${tab.repo}` : undefined,
    tab.kind === 'terminal' ? `Directory: ${tab.cwd}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The folder, open while the roster is: on a home's chip it carries
 *  the home's activity, as the home's own tab icon would. */
function ChipFolder({
  head,
  open,
  active,
}: {
  head: TabFace | null;
  open: boolean;
  active: boolean;
}) {
  const Folder = open ? FolderOpenIcon : FolderClosedIcon;
  if (!head) return <Folder aria-hidden className="size-3.5 shrink-0" />;
  return (
    <TabIcon
      Icon={Folder}
      running={head.item ? itemRunning(head.item) : head.running}
      snapshot={head.snapshot}
      active={active}
    />
  );
}

/**
 * The chip's name. With the pane's active tab among its members it reads
 * "group / member", as wide as a tab may be: the group's part is cut
 * first, so the member's label stays whole for as long as it can.
 */
function ChipLabel({
  label,
  active,
}: {
  label: string;
  active: TabFace | null;
}) {
  if (!active)
    return (
      <span data-group-label className="max-w-40 min-w-12 truncate">
        {label}
      </span>
    );
  return (
    <span className="flex max-w-56 min-w-0 items-baseline gap-1">
      <span
        data-group-label
        className="min-w-0 shrink-[100] truncate text-muted-foreground"
      >
        {label}
      </span>
      <span aria-hidden className="shrink-0 text-muted-foreground">
        /
      </span>
      <span data-group-active-label className="min-w-0 truncate">
        {active.label}
      </span>
    </span>
  );
}

/**
 * A group's chip: one control standing for the whole group on the
 * strip. Its folder, name, tab count and states; pressing it, Enter or
 * Alt+ArrowDown opens the roster of its tabs, as resting on it does, and
 * dragging it moves the group. It shows as active while the pane's
 * active tab is one of its members, and names that member.
 */
export function GroupChip({
  group,
  label,
  head,
  statuses,
  color,
  active,
  setHandle,
  handle,
  roster,
  chipRef,
  menu,
  onKeyDown,
  justDropped,
}: {
  group: TabGroup;
  label: string;
  head: TabFace | null;
  statuses: readonly TabStatus[];
  color: string | null;
  /** The pane's active tab, when it is one of the group's. */
  active: TabFace | null;
  setHandle: Sortable['setHandle'];
  handle: Sortable['handle'];
  roster: ReturnType<typeof useRosterOpen>;
  /** The chip itself, where focus returns from the roster. */
  chipRef: RefObject<HTMLDivElement | null>;
  menu: GroupMenu;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** Whether the group was just dropped: the click that follows is no press. */
  justDropped: () => boolean;
}) {
  const containsActive = active !== null;
  return (
    <PopoverAnchor asChild>
      <div
        ref={(el) => {
          setHandle(el);
          chipRef.current = el;
        }}
        {...handle}
        aria-label={[
          active ? `${label}, ${active.label}` : label,
          groupSummary(statuses),
        ].join('. ')}
        aria-selected={containsActive}
        aria-haspopup="dialog"
        aria-expanded={roster.open}
        aria-description={containsActive ? 'Contains active tab' : undefined}
        data-group-chip={group.key}
        data-home-tab={group.head?.id}
        onPointerEnter={roster.enter}
        onPointerLeave={roster.leave}
        onPointerDownCapture={roster.cancelHover}
        onKeyDown={(e) => {
          handle.onKeyDown(e);
          if (!e.defaultPrevented) onKeyDown(e);
        }}
        onClick={() => {
          if (!justDropped()) roster.press();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          runGroupMenu(menu).catch((err: unknown) =>
            toast.error(errorMessage(err))
          );
        }}
        title={chipTitle(label, head, active)}
        className={cn(
          'group/chip relative my-0.5 flex h-8 shrink-0 cursor-default items-center gap-1.5 self-center overflow-hidden rounded-md border border-border pr-1.5 pl-1.5 text-[13px] leading-5 font-medium outline-none select-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          containsActive || roster.open
            ? 'bg-tab-active text-foreground'
            : 'bg-tab text-muted-foreground hover:bg-tab-hover hover:text-foreground'
        )}
      >
        {containsActive && (
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-0.5 bg-primary"
          />
        )}
        <ChipFolder head={head} open={roster.open} active={containsActive} />
        <ChipLabel label={label} active={active} />
        <span
          data-group-count
          className="rounded bg-muted px-1 text-[11px] leading-4 tabular-nums text-muted-foreground"
        >
          {statuses.length}
        </span>
        <StatusClusters statuses={statuses} />
        <RepoBand color={color} />
      </div>
    </PopoverAnchor>
  );
}
