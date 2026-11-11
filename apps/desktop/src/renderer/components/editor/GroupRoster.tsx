import { CheckIcon } from 'lucide-react';
import { useRef, type KeyboardEvent, type RefObject } from 'react';
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
      <span className="truncate">{active ? `Active · ${status}` : status}</span>
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

function RosterRow({
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
function walkRows(e: KeyboardEvent<HTMLUListElement>): void {
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
  label,
  standIn,
  faces,
  activeId,
  roster,
  returnFocus,
  onJump,
}: {
  label: string;
  /** The parent has no tab here. */
  standIn: boolean;
  faces: readonly TabFace[];
  activeId: string | null;
  roster: ReturnType<typeof useRosterOpen>;
  /** Where focus goes when Escape closes it. */
  returnFocus: RefObject<HTMLElement | null>;
  onJump: (tab: Tab) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const escaped = useRef(false);
  const statuses = faces.map((f) => f.status);
  return (
    <PopoverContent
      data-group-roster
      role="dialog"
      aria-label={`Tabs in ${label}`}
      collisionPadding={8}
      className="flex w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden max-h-[min(480px,calc(var(--radix-popover-content-available-height)-16px))]"
      onPointerEnter={roster.enter}
      onPointerLeave={roster.leave}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        if (roster.mode !== 'keyboard') return;
        const rows =
          list.current?.querySelectorAll<HTMLElement>('[data-roster-row]');
        const current =
          list.current?.querySelector<HTMLElement>('[aria-current]');
        (current ?? rows?.[0])?.focus();
      }}
      onEscapeKeyDown={() => {
        escaped.current = true;
        roster.escaped();
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (escaped.current) returnFocus.current?.focus();
        escaped.current = false;
      }}
      onInteractOutside={(e) => {
        // The chip's own controls open and close it themselves.
        const target = e.target as Element | null;
        if (target?.closest?.('[data-group-chip]')) e.preventDefault();
      }}
    >
      <div className="flex min-h-12 shrink-0 flex-col gap-0.5 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
            {label}
          </span>
          <span className="shrink-0 rounded bg-muted px-1 text-[11px] leading-4 tabular-nums text-muted-foreground">
            {tabCount(faces.length)}
          </span>
        </div>
        {standIn && (
          <span className="text-[11px] leading-4 text-muted-foreground">
            Parent not open here
          </span>
        )}
        <span
          className="text-[11px] leading-4 text-muted-foreground"
          aria-label={groupSummary(statuses)}
        >
          {rosterSummary(statuses)}
        </span>
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
              onJump={onJump}
            />
          ))}
        </ul>
      </ScrollArea>
    </PopoverContent>
  );
}
