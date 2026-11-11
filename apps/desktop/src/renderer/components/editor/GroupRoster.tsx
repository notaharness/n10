import {
  useContext,
  useEffect,
  useRef,
  type ComponentProps,
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
import { rosterEntries } from './roster-order.js';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { PaneScopeContext } from '../../lib/tabs/tabs.js';
import { RosterRow, rosterRowId, useRosterRowDrag } from './RosterRow.js';

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
      onFocusOutside={(e) => {
        // A press on a chip in another pane focuses that pane, and its
        // terminal takes focus as the roster opens: no reason to close.
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
            onKeyDown={walkRows}
            className="flex flex-col"
          >
            {entries.map(({ face, depth }, index) => (
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
              />
            ))}
          </ul>
        </SortableContext>
      </ScrollArea>
    </PopoverContent>
  );
}
