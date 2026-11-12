import { useDndContext } from '@dnd-kit/core';
import {
  useContext,
  useEffect,
  useRef,
  type ComponentProps,
  type FocusEvent,
  type RefObject,
} from 'react';
import {
  groupSummary,
  rosterSummary,
  tabCount,
} from '../../lib/tabs/group-status.js';
import type { Tab } from '../../lib/tabs/tabs.js';
import { PopoverContent } from '../ui/popover.js';
import { ScrollArea } from '../ui/scroll-area.js';
import type { TabFace } from './use-strip-groups.js';
import type { useRosterOpen } from './use-roster-open.js';
import { walkRows } from './roster-keys.js';
import { rosterEntries } from '../../lib/tabs/roster-order.js';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { PaneScopeContext } from '../../lib/tabs/tabs.js';
import { RosterRow } from './RosterRow.js';
import { rosterRowId, useRosterRowDrag } from './use-roster-row-drag.js';

/** A row that drags: its place among `group`'s rows. */
function SortableRow({
  group,
  index,
  ...row
}: Omit<ComponentProps<typeof RosterRow>, 'drag'> & {
  group: string;
  index: number;
}) {
  const drag = useRosterRowDrag(group, row.face, index);
  return <RosterRow {...row} drag={drag} />;
}

/**
 * A group's tabs, in a popover under its chip: the home first, then the
 * members in strip order, an orchestrator's players under it
 * (`rosterEntries`), each with its state. Choosing one shows it.
 * Hover opens it without taking focus; the keyboard opens it on the
 * active row, else the first.
 */
export function GroupRoster({
  id,
  groupKey,
  label,
  faces,
  activeId,
  roster,
  returnFocus,
  onJump,
  onMenu,
  homeId,
  players,
}: {
  /** What the chip's `aria-controls` names. */
  id: string;
  groupKey: string;
  label: string;
  faces: readonly TabFace[];
  activeId: string | null;
  roster: ReturnType<typeof useRosterOpen>;
  /** Where focus goes when Escape closes it. */
  returnFocus: RefObject<HTMLElement | null>;
  onJump: (tab: Tab) => void;
  onMenu: (tab: Tab) => void;
  homeId?: string;
  /** A parent's group: its players sit under its home. */
  players: boolean;
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
  // The place of the row focus is on. When its tab leaves the group
  // (closed, pinned onto the strip), focus goes to the row now there,
  // not to the page.
  const focusedAt = useRef<number | null>(null);
  const noteFocus = (e: FocusEvent<HTMLUListElement>) => {
    const rows = [
      ...(list.current?.querySelectorAll('[data-roster-row]') ?? []),
    ];
    const row = (e.target as Element).closest('[data-roster-row]');
    focusedAt.current = row ? rows.indexOf(row) : null;
  };
  const jump = (tab: Tab) => {
    // Choosing the tab already shown changes nothing to take focus: it
    // goes back to the chip, not to the page.
    if (tab.id === activeId) escaped.current = true;
    onJump(tab);
  };
  const statuses = faces.map((f) => f.status);
  const pane = useContext(PaneScopeContext) ?? '';
  const entries = rosterEntries(faces, homeId, players);
  const rowId = (face: TabFace) => rosterRowId(pane, face.tab.id);
  const summary = rosterSummary(statuses);
  const rowIds = entries.map(({ face }) => face.tab.id).join('\n');
  useEffect(() => {
    const at = focusedAt.current;
    if (at === null || document.activeElement !== document.body) return;
    const rows =
      list.current?.querySelectorAll<HTMLElement>('[data-roster-row]');
    rows?.[Math.min(at, rows.length - 1)]?.focus();
  }, [rowIds]);
  // While a row is dragged by the keyboard, the arrows move it, not
  // the focus.
  const dragging = useDndContext().active !== null;
  return (
    <PopoverContent
      id={id}
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
      onEscapeKeyDown={(e) => {
        // Escape during a drag puts the dragged tab back; the roster
        // stays open.
        if (dragging) {
          e.preventDefault();
          return;
        }
        // A roster resting open over a terminal leaves focus there: only
        // focus taken into it, or opened by a press, goes back.
        escaped.current =
          roster.mode !== 'hover' ||
          !!document.activeElement?.closest('[data-group-roster]');
        roster.close();
      }}
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        if (escaped.current) returnFocus.current?.focus();
        escaped.current = false;
      }}
      onFocusOutside={(e) => {
        // A terminal taking focus in an editor pane (the chip's pane
        // focused as the roster opens) is no reason to close.
        const target = e.target as Element | null;
        if (target?.closest?.('[data-editor-panes]')) e.preventDefault();
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
        <SortableContext
          items={entries.map(({ face }) => rowId(face))}
          strategy={verticalListSortingStrategy}
        >
          <ul
            ref={list}
            data-roster-list
            onKeyDown={dragging ? undefined : walkRows}
            onFocus={noteFocus}
            onBlur={(e) => {
              if (e.relatedTarget) focusedAt.current = null;
            }}
            className="flex flex-col"
          >
            {entries.map(({ face, depth, tree }, index) => (
              <SortableRow
                key={face.tab.id}
                group={groupKey}
                index={index}
                face={face}
                active={face.tab.id === activeId}
                onJump={jump}
                onMenu={onMenu}
                home={face.tab.id === homeId}
                depth={depth}
                {...(tree ? { tree } : {})}
                // An orchestrator's players carry no band: only the
                // home's shows.
                band={!players || face.tab.id === homeId}
              />
            ))}
          </ul>
        </SortableContext>
      </ScrollArea>
    </PopoverContent>
  );
}
