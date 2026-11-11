import { CheckIcon } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import {
  groupSummary,
  rowStatus,
  rosterSummary,
  tabCount,
} from '../../lib/tabs/group-status.js';
import {
  repoDisplayName,
  cutSide,
  tabPresentation,
} from '../../lib/tabs/tab-presentation.js';
import type { Tab } from '../../lib/tabs/tabs.js';
import { cn } from '../../lib/utils.js';
import { PopoverContent } from '../ui/popover.js';
import { ScrollArea } from '../ui/scroll-area.js';
import { STATUS_MARK } from './StatusClusters.js';
import { UnseenDot } from './tab-marks.js';
import { FACE_ICON } from './TabIcon.js';
import { TabLabel } from './TabLabel.js';
import type { TabFace } from './use-strip-groups.js';
import type { useRosterOpen } from './use-roster-open.js';

/** Where a row's tab lives, under its label: its repository and branch,
 *  a terminal's directory, its machine when it has one. */
function secondary(face: TabFace): string {
  const { tab, machineLabel } = face;
  const where =
    tab.kind === 'terminal'
      ? tab.displayPath
      : tab.kind === 'item'
      ? [repoDisplayName(tab.repo), tab.branch].filter(Boolean).join(' · ')
      : '';
  return [machineLabel, where].filter(Boolean).join(' · ');
}

/** The row's state, at its end: active first, then the state. */
function RowStatus({
  face,
  active,
  status,
}: {
  face: TabFace;
  active: boolean;
  status: string;
}) {
  const mark = STATUS_MARK[face.status];
  return (
    <span
      className={cn(
        'flex w-[100px] shrink-0 items-center justify-end gap-1 truncate text-[11px] leading-4',
        mark?.className ?? 'text-muted-foreground'
      )}
    >
      {active && <CheckIcon aria-hidden className="size-3 shrink-0" />}
      {mark && <mark.Icon aria-hidden className="size-3 shrink-0" />}
      <span className="truncate">
        {[active ? 'Active' : '', status].filter(Boolean).join(' · ')}
      </span>
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

export function RosterRow({
  face,
  active,
  onJump,
}: {
  face: TabFace;
  active: boolean;
  onJump: (tab: Tab) => void;
}) {
  const { label, face: kind } = tabPresentation(
    face.tab,
    face.item,
    face.machineLabel
  );
  const Icon = FACE_ICON[kind];
  const status = rowStatus(face.status, {
    exited: face.snapshot?.exited ?? false,
    unseen: face.unseen,
  });
  const where = secondary(face);
  return (
    <li className="relative">
      <button
        type="button"
        data-roster-row={face.tab.id}
        aria-current={active || undefined}
        aria-label={rowName(label, where, active, status)}
        onClick={() => onJump(face.tab)}
        className={cn(
          'flex h-11 w-full items-center gap-2 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
          active ? 'bg-tab-active' : 'hover:bg-tab-hover'
        )}
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] leading-5">
            <TabLabel
              label={label}
              preview={face.tab.preview}
              foreignRepo={null}
              cut={cutSide(kind)}
            />
            {face.unseen && <UnseenDot />}
          </span>
          {where && (
            <span
              title={where}
              className="truncate text-[11px] leading-4 text-muted-foreground"
            >
              {where}
            </span>
          )}
        </span>
        <RowStatus face={face} active={active} status={status} />
      </button>
      <RowBand color={face.repoColor} />
    </li>
  );
}

/** Arrow keys walk the rows without wrapping; Home and End go to the
 *  ends. */
export function walkRows(e: KeyboardEvent<HTMLElement>): void {
  const rows = [
    ...e.currentTarget.querySelectorAll<HTMLElement>('[data-roster-row]'),
  ];
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'ArrowDown'
      ? Math.min(at + 1, rows.length - 1)
      : e.key === 'ArrowUp'
      ? Math.max(at - 1, 0)
      : e.key === 'Home'
      ? 0
      : e.key === 'End'
      ? rows.length - 1
      : null;
  if (next === null) return;
  e.preventDefault();
  rows[next]?.focus();
}

/**
 * A group's tabs, in a popover under its chip: the home first, then the
 * members in strip order, each with its state. Choosing one shows it.
 * Hover opens it without taking focus; the keyboard opens it on the
 * active row, else the first.
 */
export function GroupRoster({
  groupKey,
  label,
  faces,
  activeId,
  roster,
  returnFocus,
  onJump,
}: {
  groupKey: string;
  label: string;
  faces: readonly TabFace[];
  activeId: string | null;
  roster: ReturnType<typeof useRosterOpen>;
  /** Where focus goes when Escape closes it. */
  returnFocus: RefObject<HTMLElement | null>;
  onJump: (tab: Tab) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const escaped = useRef(false);
  // Opened from the keyboard, or already open when Alt+ArrowDown asked
  // for it: focus goes to the active row, else the first. The content
  // mounts a render after it opens, so a fresh open focuses on mount.
  const keyboard = roster.mode === 'keyboard';
  const focusRows = () => {
    const rows =
      list.current?.querySelectorAll<HTMLElement>('[data-roster-row]');
    const current = list.current?.querySelector<HTMLElement>('[aria-current]');
    (current ?? rows?.[0])?.focus();
  };
  useEffect(() => {
    if (keyboard) focusRows();
  }, [keyboard]);
  const jump = (tab: Tab) => {
    // Choosing the tab already shown changes nothing to take focus: it
    // goes back to the chip, not to the page.
    if (tab.id === activeId) escaped.current = true;
    onJump(tab);
  };
  const statuses = faces.map((f) => f.status);
  const summary = rosterSummary(statuses);
  return (
    <PopoverContent
      data-group-roster
      role="dialog"
      aria-label={`Tabs in ${label}`}
      collisionPadding={8}
      className="flex w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden max-h-[min(480px,calc(var(--radix-popover-content-available-height)-16px))]"
      onPointerEnter={roster.enter}
      onPointerLeave={roster.leave}
      // Focus moves in only from the keyboard.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        if (keyboard) focusRows();
      }}
      onEscapeKeyDown={() => {
        // A roster resting open over a terminal leaves focus there: only
        // focus taken into it, or opened by a press, goes back.
        escaped.current =
          roster.mode !== 'hover' ||
          !!document.activeElement?.closest('[data-group-roster]');
        roster.escaped();
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (escaped.current) returnFocus.current?.focus();
        escaped.current = false;
      }}
      onInteractOutside={(e) => {
        // This chip's own controls open and close it themselves; any
        // other chip is outside.
        const target = e.target as Element | null;
        const chip = target?.closest?.('[data-group-chip]');
        if (chip?.getAttribute('data-group-chip') === groupKey)
          e.preventDefault();
      }}
    >
      <div className="flex min-h-12 shrink-0 flex-col justify-center gap-0.5 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {label}
          </span>
          <span className="shrink-0 rounded bg-muted px-1 text-[11px] leading-4 tabular-nums text-muted-foreground">
            {tabCount(faces.length)}
          </span>
        </div>
        {summary && (
          <span
            className="text-[11px] leading-4 text-muted-foreground"
            aria-label={groupSummary(statuses)}
          >
            {summary}
          </span>
        )}
      </div>
      <ScrollArea
        className="min-h-0 flex-1"
        viewportClassName="max-h-[inherit]"
      >
        <ul ref={list} onKeyDown={walkRows} className="flex flex-col">
          {faces.map((face) => (
            <RosterRow
              key={face.tab.id}
              face={face}
              active={face.tab.id === activeId}
              onJump={jump}
            />
          ))}
        </ul>
      </ScrollArea>
    </PopoverContent>
  );
}
