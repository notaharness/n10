import { BrainIcon, FolderClosedIcon, FolderOpenIcon } from 'lucide-react';
import type { ChipSignal } from '../../lib/tabs/group-status.js';
import { usePlanTotal } from '../../lib/plan/plan.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import { chipClassName } from './tab-look-class.js';
import { PlanCountBadge, RepoBand, UnseenDot } from './tab-marks.js';
import { TabIcon } from './TabIcon.js';
import type { TabFace } from './use-strip-groups.js';

/**
 * What a group's chip shows, drawn the same on the strip (`GroupChip`,
 * which wires it to its control) and in the copy that follows the
 * pointer out of it (`CarriedOverlay`). A chip is a tab to look at: the
 * same frame, colours, blink and spinner, with a folder or an
 * orchestrator's brain for its icon and its tab count at its end.
 */

/** The chip's icon: an orchestrator's brain, with its home's running
 *  dot, or a folder, open while the roster is. It spins while the
 *  chip's signal says its group works. */
function ChipIcon({
  head,
  open,
  active,
  working,
}: {
  head: TabFace | null;
  open: boolean;
  active: boolean;
  working: boolean;
}) {
  const Icon = head ? BrainIcon : open ? FolderOpenIcon : FolderClosedIcon;
  const running = head
    ? head.item
      ? itemRunning(head.item)
      : head.running
    : false;
  return (
    <TabIcon
      Icon={Icon}
      running={running}
      snapshot={undefined}
      working={working}
      active={active}
    />
  );
}

/**
 * The chip's name. With the pane's active tab among its members it reads
 * "group / member", as wide as a tab may be: the group's part is cut
 * first, and the member's label stops 3.5rem short of the whole width,
 * so a few letters of the group always show.
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
      <span data-group-label className="min-w-0 flex-1 truncate">
        {label}
      </span>
    );
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1">
      <span
        data-group-label
        className="min-w-0 shrink-[100] truncate text-muted-foreground"
      >
        {label}
      </span>
      <span aria-hidden className="shrink-0 text-muted-foreground">
        /
      </span>
      <span
        data-group-active-label
        className="max-w-[min(9rem,calc(100%-3.5rem))] min-w-0 truncate"
      >
        {active.label}
      </span>
    </span>
  );
}

/** The chip's insides: icon, name, its members' plan total, the mark
 *  of a tab behind it not yet looked at, tab count and repository band. */
export function ChipFace({
  head,
  label,
  active,
  count,
  planIds,
  color,
  signal,
  open,
}: {
  head: TabFace | null;
  label: string;
  /** The pane's active tab, when it is one of the group's. */
  active: TabFace | null;
  count: number;
  /** Its members' pull requests: a plan is built in a tab and walked
   *  away from, so the chip carries their plans' total. */
  planIds: readonly number[];
  color: string | null;
  signal: ChipSignal;
  open: boolean;
}) {
  const planned = usePlanTotal(planIds);
  return (
    <>
      <ChipIcon
        head={head}
        open={open}
        active={active !== null}
        working={signal.working}
      />
      <ChipLabel label={label} active={active} />
      <PlanCountBadge count={planned} />
      {signal.unseen && <UnseenDot />}
      <span
        data-group-count
        className="shrink-0 rounded bg-muted px-1 text-[11px] leading-4 tabular-nums text-muted-foreground"
      >
        {count}
      </span>
      <RepoBand color={color} />
    </>
  );
}

/** A whole chip, inert: what a carried group looks like. */
export function ChipLook(face: Parameters<typeof ChipFace>[0]) {
  return (
    <div
      className={chipClassName({
        containsActive: face.active !== null,
        flashing: face.signal.flashing,
        unseen: face.signal.unseen,
        dragging: false,
        wrap: false,
      })}
    >
      <ChipFace {...face} />
    </div>
  );
}
