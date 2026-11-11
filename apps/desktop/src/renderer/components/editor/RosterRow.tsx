import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BrainIcon, CheckIcon } from 'lucide-react';
import { useContext, useRef, type CSSProperties } from 'react';
import { rowStatus } from '../../lib/tabs/group-status.js';
import { cutSide } from '../../lib/tabs/tab-presentation.js';
import { PaneScopeContext, type Tab } from '../../lib/tabs/tabs.js';
import { cn } from '../../lib/utils.js';
import { usePlanCount } from '../../lib/plan/plan.js';
import { PlanCountBadge, UnseenDot } from './tab-marks.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import type { TabStatus } from '../../lib/tabs/tab-groups.js';
import { useSlotStyle } from './drag-preview.js';
import { FACE_ICON, TabIcon } from './TabIcon.js';
import { TabLabel } from './TabLabel.js';
import type { TabFace } from './use-strip-groups.js';
import type { RosterEntry } from './roster-order.js';
import { rosterSecondary } from './roster-text.js';

/**
 * A roster's row: one of its group's tabs, drawn as the tab would be,
 * indented under its orchestrator or player. Pressing it shows the tab;
 * dragging it moves the tab among the group's rows, or out to another
 * pane's strip or a pane's side (`strip-drag.ts`).
 */

/** Each state's colour token in a row's words; idle has none. */
const STATUS_TONE: Partial<Record<TabStatus, string>> = {
  blocked: 'text-warning',
  error: 'text-destructive',
  'done-unseen': 'text-success',
  'new-output': 'text-info',
};

/** The row's state, at its end, in words: active first, then the
 *  state. The row itself blinks and spins as its tab would. */
function RowStatus({
  face,
  active,
  status,
}: {
  face: TabFace;
  active: boolean;
  status: string;
}) {
  return (
    <span
      className={cn(
        'flex w-[100px] shrink-0 items-center justify-end gap-1 truncate text-[11px] leading-4',
        STATUS_TONE[face.status] ?? 'text-muted-foreground'
      )}
    >
      {active && <CheckIcon aria-hidden className="size-3 shrink-0" />}
      <span className="truncate">
        {[active ? 'Active' : '', status].filter(Boolean).join(' · ')}
      </span>
    </span>
  );
}

/** The row's icon, an orchestrator's brain for the home, spinning
 *  while its tab works, as the tab's own would. */
function RowIcon({
  face,
  home,
  active,
}: {
  face: TabFace;
  home: boolean;
  active: boolean;
}) {
  return (
    <span className="flex shrink-0 text-muted-foreground">
      <TabIcon
        Icon={home ? BrainIcon : FACE_ICON[face.labelKind]}
        running={face.item ? itemRunning(face.item) : face.running}
        snapshot={face.snapshot}
        active={active}
      />
    </span>
  );
}

/** The row's repository colour, down its leading edge. */
function RowBand({ color }: { color: string | null }) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 left-0 w-0.5"
      style={{ backgroundColor: color }}
    />
  );
}

function rowName(
  label: string,
  where: string,
  active: boolean,
  status: string
) {
  return [label, where, active ? 'Active' : '', status]
    .filter(Boolean)
    .join(', ');
}

/** The row's two lines: its label with its marks, and where it is. */
function RowText({
  face,
  label,
  home,
  where,
}: {
  face: TabFace;
  label: string;
  home: boolean;
  where: string;
}) {
  const planned = usePlanCount(face.item?.pr?.id);
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5">
        <TabLabel
          label={label}
          parts={home ? undefined : face.labelParts}
          machineLabel={face.machineLabel}
          preview={face.tab.preview}
          cut={face.labelSource === 'task' ? 'end' : cutSide(face.labelKind)}
        />
        <PlanCountBadge count={planned} />
        {face.unseen && <UnseenDot />}
      </span>
      {where && (
        <span className="truncate text-[11px] leading-4 text-muted-foreground">
          {where}
        </span>
      )}
    </span>
  );
}

/** One level's indent, in px: wide enough that a player hangs under
 *  its orchestrator, with a 10px elbow into its icon. */
const STEP = 20;
/** How far in a row of `depth` starts: a step per level. */
const indent = (depth: number) => `${8 + STEP * depth}px`;
/** The centre of a row's icon at `depth`, in px: its start plus half
 *  the 16px icon. */
const iconCentre = (depth: number) => 8 + STEP * depth + 8;

type Tree = NonNullable<RosterEntry<TabFace>['tree']>;

/** One guide line, in a muted ink: a tree to read, not a border. */
function Guide({ style }: { style: CSSProperties }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute w-px bg-muted-foreground/40"
      style={style}
    />
  );
}

/**
 * An orchestrator's roster drawn as a tree: from the home's icon down
 * to its players, an elbow into each and a corner at the last, and the
 * same a level deeper for a player's own tabs. The icons sit on the
 * row's middle, 44px rows, 16px icons.
 */
function RowGuides({ depth, tree }: { depth: number; tree: Tree }) {
  const lines: [string, CSSProperties][] = [];
  tree.through.forEach((on, level) => {
    if (on)
      lines.push([
        `through-${level}`,
        { left: iconCentre(level), top: 0, bottom: 0 },
      ]);
  });
  if (depth > 0) {
    const x = iconCentre(depth - 1);
    // Down from the row above, to the middle when this is the last.
    lines.push([
      'down',
      tree.last
        ? { left: x, top: 0, height: 22 }
        : { left: x, top: 0, bottom: 0 },
    ]);
    // Across into this row's icon.
    lines.push([
      'across',
      { left: x, top: 22, width: iconCentre(depth) - 10 - x, height: 1 },
    ]);
  }
  // Down from this row's icon to the rows under it.
  if (tree.branches)
    lines.push(['branch', { left: iconCentre(depth), top: 32, bottom: 0 }]);
  return (
    <>
      {lines.map(([key, style]) => (
        <Guide key={key} style={style} />
      ))}
    </>
  );
}

/** What a row says of its tab: its label (an orchestrator's home is
 *  named for it), whether it blinks, its state and where it is. */
function rowFacts(face: TabFace, home: boolean, active: boolean) {
  return {
    label: home
      ? ['Orchestrator', face.taskTitle].filter(Boolean).join(' · ')
      : face.label,
    flashing: !active && (face.snapshot?.flashing ?? false),
    status: rowStatus(face.status, {
      exited: face.snapshot?.exited ?? false,
      unseen: face.unseen,
    }),
    where: rosterSecondary(face),
  };
}

/** What a sortable row spreads on its elements (`useRosterRowDrag`). */
type RowDrag = ReturnType<typeof useRosterRowDrag>;

export function RosterRow({
  face,
  active,
  onJump,
  onMenu,
  home,
  depth = 0,
  drag,
  tree,
  band = true,
}: {
  face: TabFace;
  active: boolean;
  onJump: (tab: Tab) => void;
  /** The tab's native menu, from its row. */
  onMenu?: (tab: Tab) => void;
  home: boolean;
  /** Under the home (1), or under a player too (2). */
  depth?: number;
  /** In a group's roster, where a row drags. */
  drag?: RowDrag;
  /** An orchestrator's roster: the row's guides. */
  tree?: Tree;
  /** Its repository's band down its edge: none on a player, nor on a
   *  player's tabs, which the orchestrator watches. */
  band?: boolean;
}) {
  const { label, flashing, status, where } = rowFacts(face, home, active);
  return (
    <li ref={drag?.setNode} style={drag?.style} className="relative">
      <button
        type="button"
        {...drag?.handle}
        data-roster-row={face.tab.id}
        aria-current={active || undefined}
        data-roster-depth={depth}
        style={{ paddingInlineStart: indent(depth) }}
        aria-label={rowName(label, where, active, status)}
        onClick={() => {
          if (!drag?.justDropped()) onJump(face.tab);
        }}
        onContextMenu={
          onMenu &&
          ((e) => {
            e.preventDefault();
            onMenu(face.tab);
          })
        }
        className={cn(
          'flex h-11 w-full items-center gap-2 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          active ? 'bg-tab-active' : 'bg-tab hover:bg-tab-hover',
          flashing && 'tab-attention'
        )}
      >
        <RowIcon face={face} home={home} active={active} />
        <RowText face={face} label={label} home={home} where={where} />
        <RowStatus face={face} active={active} status={status} />
      </button>
      {tree && <RowGuides depth={depth} tree={tree} />}
      {band && <RowBand color={face.repoColor} />}
    </li>
  );
}

/** A roster row's sortable id: the tab's, in `pane`, apart from the
 *  strip's blocks. */
export const rosterRowId = (pane: string, tabId: string) =>
  `row:${pane}:${tabId}`;

/**
 * A row of `group`'s roster as a sortable place (`strip-drag.ts`): its
 * tab, at `index` among the rows, in the pane the roster's chip is on.
 * The click a drop ends in is no press (`justDropped`).
 */
export function useRosterRowDrag(group: string, face: TabFace, index: number) {
  const pane = useContext(PaneScopeContext) ?? '';
  const id = rosterRowId(pane, face.tab.id);
  const slot = useSlotStyle(id);
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: {
      kind: 'block',
      label: face.label,
      ids: [face.tab.id],
      index,
      pane,
      row: group,
    },
  });
  const dropped = useRef(false);
  return {
    setNode: setNodeRef,
    handle: {
      // A button already: its role and focus stay its own.
      'aria-roledescription': 'sortable tab',
      'aria-describedby': attributes['aria-describedby'],
      ...listeners,
      onPointerUp: () => {
        // Moved far enough to drag: the click that follows is the drop's.
        dropped.current = isDragging;
        setTimeout(() => (dropped.current = false), 0);
      },
    },
    style: {
      position: 'relative' as const,
      zIndex: isDragging ? 10 : undefined,
      ...slot(isDragging, CSS.Translate.toString(transform), transition),
    },
    justDropped: () => dropped.current,
  };
}
