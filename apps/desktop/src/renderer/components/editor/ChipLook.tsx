import {
  FolderClosedIcon,
  FolderOpenIcon,
  GripVerticalIcon,
} from 'lucide-react';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import type { TabStatus } from '../../lib/tabs/tab-groups.js';
import { cutSide } from '../../lib/tabs/tab-presentation.js';
import { StatusClusters } from './StatusClusters.js';
import { CHIP_BODY, chipClassName } from './tab-look-class.js';
import { RepoBand } from './tab-marks.js';
import { TabIcon } from './TabIcon.js';
import { TabLabel } from './TabLabel.js';
import { TabEnd } from './TabLook.js';
import type { TabFace } from './use-strip-groups.js';

/**
 * What a group's chip shows, drawn the same on the strip (`GroupChip`,
 * which wires each part to its control) and in the copy that follows
 * the pointer out of it (`CarriedOverlay`).
 */

/** The grip a chip shows on hover or focus, in a slot kept for it. */
export function Grip() {
  return (
    <GripVerticalIcon
      aria-hidden
      className="size-3.5 shrink-0 opacity-0 group-hover/chip:opacity-60 group-focus-within/chip:opacity-60"
    />
  );
}

/** The rule along the top of a chip whose group holds the active tab. */
export function ChipActiveRule() {
  return (
    <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
  );
}

/** The chip's one icon, its disclosure's: a closed folder collapsed, an
 *  open one expanded, with the home's activity hanging off it. */
export function ChipIcon({
  head,
  collapsed,
  active,
}: {
  head: TabFace | null;
  collapsed: boolean;
  active: boolean;
}) {
  const Folder = collapsed ? FolderClosedIcon : FolderOpenIcon;
  return head ? (
    <TabIcon
      Icon={Folder}
      iconClassName="size-3.5"
      running={head.item ? itemRunning(head.item) : head.running}
      snapshot={head.snapshot}
      active={active}
    />
  ) : (
    <Folder aria-hidden className="size-3.5" />
  );
}

/** The home's label in the chip: the group's name, cut as the home's
 *  own label would be when it is that, with the home's marks. */
export function HomeLabel({ face, name }: { face: TabFace; name: string }) {
  const { label, labelKind: kind } = face;
  return (
    <>
      <span className="flex max-w-40 min-w-16">
        <TabLabel
          label={name}
          preview={face.tab.preview}
          cut={name === label && face.labelSource !== 'task' ? cutSide(kind) : 'end'}
        />
      </span>
      <TabEnd item={face.item} unseen={face.unseen} />
      <Grip />
    </>
  );
}

/** A chip with no home here: its group's name. */
export function PlaceLabel({ label }: { label: string }) {
  return (
    <>
      <span className="max-w-40 min-w-16 truncate">{label}</span>
      <Grip />
    </>
  );
}

/** The group's count and its members' states. */
export function ChipCount({ statuses }: { statuses: readonly TabStatus[] }) {
  return (
    <>
      <span
        data-group-count
        className="rounded bg-muted px-1 text-[11px] leading-4 tabular-nums text-muted-foreground"
      >
        {statuses.length}
      </span>
      <StatusClusters statuses={statuses} />
    </>
  );
}

/** A whole chip, inert: what a carried group looks like. */
export function ChipLook({
  head,
  label,
  statuses,
  color,
  collapsed,
  containsActive,
}: {
  head: TabFace | null;
  label: string;
  statuses: readonly TabStatus[];
  color: string | null;
  collapsed: boolean;
  containsActive: boolean;
}) {
  return (
    <div className={chipClassName(containsActive)}>
      {containsActive && <ChipActiveRule />}
      <span className="flex h-full w-6 shrink-0 items-center justify-center">
        <ChipIcon head={head} collapsed={collapsed} active={containsActive} />
      </span>
      <span className={CHIP_BODY}>
        {head ? (
          <HomeLabel face={head} name={label} />
        ) : (
          <PlaceLabel label={label} />
        )}
      </span>
      <span className="flex h-full shrink-0 items-center gap-2 pr-1.5 pl-1">
        <ChipCount statuses={statuses} />
      </span>
      <RepoBand color={color} />
    </div>
  );
}
